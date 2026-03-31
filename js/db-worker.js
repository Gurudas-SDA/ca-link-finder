/* ===========================================================================
   PPP Link Finder — SQL.js Web Worker
   Runs all SQLite operations off the main thread to prevent UI freezes.

   Protocol:
     Main → Worker:  { id, cmd, ... }
     Worker → Main:  { id, cmd, result|error, ... }
     Worker → Main:  { cmd:'progress', dbName, progress }  (no id, broadcast)
   =========================================================================== */

var SQL = null;
var databases = {};  // { dbName: SQL.Database }

var WASM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm';
var SQL_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.js';

// Load sql.js in Worker context
importScripts(SQL_JS_CDN);

/**
 * Initialize sql.js WASM engine.
 */
function initEngine() {
    if (SQL) return Promise.resolve();
    return initSqlJs({
        locateFile: function () { return WASM_CDN; }
    }).then(function (sqlModule) {
        SQL = sqlModule;
    });
}

var CACHE_NAME = 'ppp-db-cache-v1';

/**
 * Fetch a DB file with progress reporting, then create SQL.Database.
 * Uses Cache API to avoid re-downloading on page reload.
 */
function loadDB(dbName, url) {
    // Try Cache API first
    if (typeof caches !== 'undefined') {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(url).then(function (cachedResponse) {
                if (cachedResponse) {
                    // Cache hit — load from cache (fast)
                    self.postMessage({ cmd: 'progress', dbName: dbName, progress: 0.5 });
                    return cachedResponse.arrayBuffer().then(function (buf) {
                        self.postMessage({ cmd: 'progress', dbName: dbName, progress: 0.9 });
                        var arr = new Uint8Array(buf);
                        databases[dbName] = new SQL.Database(arr);
                        self.postMessage({ cmd: 'progress', dbName: dbName, progress: 1.0 });
                    });
                }
                // Cache miss — fetch with progress, then cache
                return fetchWithProgress(dbName, url).then(function (arrayBuffer) {
                    // Store in cache for next time
                    var response = new Response(arrayBuffer, {
                        headers: { 'Content-Type': 'application/octet-stream' }
                    });
                    cache.put(url, response);
                });
            });
        }).catch(function () {
            // Cache API failed — fall back to direct fetch
            return fetchWithProgress(dbName, url);
        });
    }
    // No Cache API — direct fetch
    return fetchWithProgress(dbName, url);
}

/**
 * Fetch DB with XHR progress reporting and create SQL.Database.
 */
function fetchWithProgress(dbName, url) {
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';

        xhr.onprogress = function (e) {
            if (e.lengthComputable) {
                self.postMessage({ cmd: 'progress', dbName: dbName, progress: e.loaded / e.total });
            }
        };

        xhr.onload = function () {
            if (xhr.status === 200 || xhr.status === 0) {
                try {
                    var arr = new Uint8Array(xhr.response);
                    // This is the heavy operation — runs in Worker, doesn't block UI
                    databases[dbName] = new SQL.Database(arr);
                    resolve(xhr.response);
                } catch (err) {
                    reject(err);
                }
            } else {
                reject(new Error('HTTP ' + xhr.status + ' loading ' + url));
            }
        };

        xhr.onerror = function () {
            reject(new Error('Network error loading ' + url));
        };

        xhr.send();
    });
}

/**
 * Execute a SQL query and return results as array of objects.
 */
function runQuery(dbName, sql, params) {
    var db = databases[dbName];
    if (!db) throw new Error('Database "' + dbName + '" not loaded');

    var results = [];
    var stmt = db.prepare(sql);
    try {
        if (params) stmt.bind(params);
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
    } finally {
        stmt.free();
    }
    return results;
}

/**
 * Handle messages from main thread.
 */
self.onmessage = function (e) {
    var msg = e.data;
    var id = msg.id;

    switch (msg.cmd) {
        case 'init':
            initEngine().then(function () {
                self.postMessage({ id: id, cmd: 'init', result: true });
            }).catch(function (err) {
                self.postMessage({ id: id, cmd: 'init', error: err.message });
            });
            break;

        case 'loadDB':
            initEngine().then(function () {
                return loadDB(msg.dbName, msg.url);
            }).then(function () {
                self.postMessage({ id: id, cmd: 'loadDB', result: true, dbName: msg.dbName });
            }).catch(function (err) {
                self.postMessage({ id: id, cmd: 'loadDB', error: err.message, dbName: msg.dbName });
            });
            break;

        case 'query':
            try {
                var rows = runQuery(msg.dbName, msg.sql, msg.params);
                self.postMessage({ id: id, cmd: 'query', result: rows });
            } catch (err) {
                self.postMessage({ id: id, cmd: 'query', error: err.message });
            }
            break;

        case 'isLoaded':
            self.postMessage({ id: id, cmd: 'isLoaded', result: !!databases[msg.dbName] });
            break;
    }
};
