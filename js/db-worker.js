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

var CACHE_NAME = 'ppp-db-cache-v2';

// Clean up old cache versions
if (typeof caches !== 'undefined') {
    caches.keys().then(function (names) {
        names.forEach(function (name) {
            if (name.startsWith('ppp-db-cache-') && name !== CACHE_NAME) {
                caches.delete(name);
            }
        });
    });
}

/**
 * Fetch a DB file with progress reporting, then create SQL.Database.
 * Uses Cache API with stale-while-revalidate:
 *   1. If cached — load instantly (fast UX)
 *   2. Background HEAD check — if server has newer version, re-download and update cache
 *   3. Next page load gets fresh DB automatically
 */
function loadDB(dbName, url) {
    if (typeof caches !== 'undefined') {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(url).then(function (cachedResponse) {
                if (cachedResponse) {
                    // Cache hit — load from cache (fast)
                    self.postMessage({ cmd: 'progress', dbName: dbName, progress: 0.5 });

                    // Background revalidation — check if server has newer version
                    var cachedLen = cachedResponse.headers.get('x-original-size') ||
                                    cachedResponse.headers.get('content-length') || '0';
                    fetch(url, { method: 'HEAD' }).then(function (headResp) {
                        if (!headResp.ok) return;
                        var serverLen = headResp.headers.get('content-length') || '0';
                        if (serverLen !== cachedLen && serverLen !== '0') {
                            // Server has different version — re-download in background
                            fetch(url).then(function (resp) {
                                if (!resp.ok) return;
                                var contentLen = resp.headers.get('content-length') || '0';
                                return resp.arrayBuffer().then(function (buf) {
                                    var freshResp = new Response(buf, {
                                        headers: {
                                            'Content-Type': 'application/octet-stream',
                                            'x-original-size': contentLen
                                        }
                                    });
                                    cache.put(url, freshResp);
                                });
                            }).catch(function () { /* silent */ });
                        }
                    }).catch(function () { /* silent — offline is fine */ });

                    return cachedResponse.arrayBuffer().then(function (buf) {
                        self.postMessage({ cmd: 'progress', dbName: dbName, progress: 0.9 });
                        var arr = new Uint8Array(buf);
                        databases[dbName] = new SQL.Database(arr);
                        self.postMessage({ cmd: 'progress', dbName: dbName, progress: 1.0 });
                    });
                }
                // Cache miss — fetch with progress, then cache
                return fetchWithProgress(dbName, url).then(function (arrayBuffer) {
                    var contentLen = String(arrayBuffer.byteLength);
                    var response = new Response(arrayBuffer, {
                        headers: {
                            'Content-Type': 'application/octet-stream',
                            'x-original-size': contentLen
                        }
                    });
                    cache.put(url, response);
                });
            });
        }).catch(function () {
            return fetchWithProgress(dbName, url);
        });
    }
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
