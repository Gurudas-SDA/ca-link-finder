/* ===========================================================================
   PPP Link Finder — Database abstraction (sql.js / SQLite in browser)
   =========================================================================== */
window.PPP = window.PPP || {};

PPP.db = (function () {
    'use strict';

    var SQL = null;       // sql.js module
    var metaDB = null;    // meta database instance
    var transcriptsDB = null; // transcripts database instance (lazy)
    var transcriptsLoading = false;
    var htmlDBs = {};         // {lang: Database} — HTML transcript databases
    var htmlDBLoading = {};   // {lang: true} — loading flags

    // CDN fallback URL for WASM file
    var WASM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm';

    /**
     * Initialize sql.js WASM engine.
     * Uses CDN WASM (sql.js 1.11.0, standard build — no FTS5).
     */
    function initSqlJs() {
        if (SQL) return Promise.resolve(SQL);

        // Always use CDN WASM (local lib/ may not have it)
        return window.initSqlJs({
            locateFile: function () {
                return WASM_CDN;
            }
        }).then(function (sqlModule) {
            SQL = sqlModule;
            return SQL;
        });
    }

    /**
     * Fetch and open the metadata database.
     * Returns a Promise<Database>.
     */
    function loadMetaDB(progressCallback) {
        if (metaDB) return Promise.resolve(metaDB);

        return fetchDB('data/ppp_meta.db', progressCallback).then(function (db) {
            metaDB = db;
            return metaDB;
        });
    }

    /**
     * Lazy-fetch the transcripts database (only when user searches transcripts).
     * Returns a Promise<Database>.
     */
    function loadTranscriptsDB(progressCallback) {
        if (transcriptsDB) return Promise.resolve(transcriptsDB);
        if (transcriptsLoading) {
            // Return a polling promise if already loading
            return new Promise(function (resolve) {
                var check = setInterval(function () {
                    if (transcriptsDB) { clearInterval(check); resolve(transcriptsDB); }
                }, 100);
            });
        }

        transcriptsLoading = true;
        return fetchDB('data/ppp_transcripts_en.db', progressCallback).then(function (db) {
            transcriptsDB = db;
            transcriptsLoading = false;
            return transcriptsDB;
        }).catch(function (err) {
            transcriptsLoading = false;
            throw err;
        });
    }

    /**
     * Internal: fetch a .db file and create a sql.js Database.
     */
    function fetchDB(url, progressCallback) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';

            if (progressCallback) {
                xhr.onprogress = function (e) {
                    if (e.lengthComputable) {
                        progressCallback(e.loaded / e.total);
                    }
                };
            }

            xhr.onload = function () {
                if (xhr.status === 200 || xhr.status === 0) {
                    // Use setTimeout to let UI update before heavy SQL.Database parsing
                    setTimeout(function () {
                        try {
                            var uInt8Array = new Uint8Array(xhr.response);
                            var db = new SQL.Database(uInt8Array);
                            resolve(db);
                        } catch (err) {
                            reject(err);
                        }
                    }, 50);
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
     * Run a SQL query on the meta database.
     * Returns array of objects [{col: val, ...}, ...].
     */
    function queryMeta(sql, params) {
        if (!metaDB) throw new Error('Meta DB not loaded');
        return runQuery(metaDB, sql, params);
    }

    /**
     * Run a SQL query on the transcripts database.
     * Returns array of objects [{col: val, ...}, ...].
     */
    function queryTranscripts(sql, params) {
        if (!transcriptsDB) throw new Error('Transcripts DB not loaded');
        return runQuery(transcriptsDB, sql, params);
    }

    /**
     * Internal: execute SQL and return results as objects.
     */
    function runQuery(db, sql, params) {
        var results = [];
        try {
            var stmt = db.prepare(sql);
            if (params) stmt.bind(params);
            while (stmt.step()) {
                var row = stmt.getAsObject();
                results.push(row);
            }
            stmt.free();
        } catch (err) {
            console.error('SQL error:', err.message, '\nQuery:', sql);
            throw err;
        }
        return results;
    }

    /**
     * Get pre-computed stats from the stats table in meta DB.
     */
    function getStats() {
        if (!metaDB) return null;
        try {
            var rows = runQuery(metaDB, 'SELECT key, value FROM stats');
            var stats = {};
            rows.forEach(function (r) {
                stats[r.key] = r.value;
            });
            return stats;
        } catch (e) {
            // stats table might not exist — count from lectures
            try {
                var countRows = runQuery(metaDB, 'SELECT COUNT(*) as cnt FROM lectures');
                return { total_lectures: countRows[0].cnt };
            } catch (e2) {
                return { total_lectures: 0 };
            }
        }
    }

    /**
     * Lazy-load an HTML transcript database for a given language.
     * Returns Promise<Database>.
     */
    function loadHtmlDB(lang, progressCallback) {
        lang = lang || 'en';
        if (htmlDBs[lang]) return Promise.resolve(htmlDBs[lang]);
        if (htmlDBLoading[lang]) {
            return new Promise(function (resolve) {
                var check = setInterval(function () {
                    if (htmlDBs[lang]) { clearInterval(check); resolve(htmlDBs[lang]); }
                }, 100);
            });
        }
        htmlDBLoading[lang] = true;
        return fetchDB('data/ppp_transcripts_html_' + lang + '.db', progressCallback).then(function (db) {
            htmlDBs[lang] = db;
            htmlDBLoading[lang] = false;
            return db;
        }).catch(function (err) {
            htmlDBLoading[lang] = false;
            throw err;
        });
    }

    /**
     * Query an HTML transcript database.
     */
    function queryHtmlTranscripts(lang, sql, params) {
        if (!htmlDBs[lang]) throw new Error('HTML DB (' + lang + ') not loaded');
        return runQuery(htmlDBs[lang], sql, params);
    }

    function isHtmlLoaded(lang) {
        return !!htmlDBs[lang || 'en'];
    }

    /**
     * Check if meta DB is loaded.
     */
    function isMetaLoaded() {
        return metaDB !== null;
    }

    /**
     * Check if transcripts DB is loaded.
     */
    function isTranscriptsLoaded() {
        return transcriptsDB !== null;
    }

    return {
        initSqlJs: initSqlJs,
        loadMetaDB: loadMetaDB,
        loadTranscriptsDB: loadTranscriptsDB,
        loadHtmlDB: loadHtmlDB,
        queryMeta: queryMeta,
        queryTranscripts: queryTranscripts,
        queryHtmlTranscripts: queryHtmlTranscripts,
        getStats: getStats,
        isMetaLoaded: isMetaLoaded,
        isTranscriptsLoaded: isTranscriptsLoaded,
        isHtmlLoaded: isHtmlLoaded
    };
})();
