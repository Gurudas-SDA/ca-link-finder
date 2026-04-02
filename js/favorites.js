/* ===========================================================================
   PPP Link Finder — Collections (localStorage + Firestore sync)
   YouTube-style "Save to..." with multiple folders/collections.
   Backward compatible — migrates old ppp_favorites on first load.

   Firestore sync:
   - On login: merges localStorage ↔ Firestore (union of lectures)
   - On change: debounced 2s write to Firestore
   - Offline: localStorage always works, syncs when back online
   =========================================================================== */
window.PPP = window.PPP || {};

PPP.favorites = (function () {
    'use strict';

    var STORAGE_KEY = 'ppp_collections';
    var OLD_KEY = 'ppp_favorites';
    var _collections = []; // [{id, name, created, lectures: [nr,...]}]
    var _nextId = 1;
    var _userId = null;
    var _syncTimer = null;
    var SYNC_DEBOUNCE = 2000; // ms

    // ===== Persistence (localStorage) =====
    function _load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                _collections = data.collections || [];
                _nextId = data.nextId || 1;
            }
        } catch (e) { /* ignore corrupt data */ }

        // Migrate old favorites
        if (_collections.length === 0) {
            try {
                var oldRaw = localStorage.getItem(OLD_KEY);
                if (oldRaw) {
                    var oldNrs = JSON.parse(oldRaw);
                    if (oldNrs.length > 0) {
                        _collections.push({
                            id: _nextId++,
                            name: 'Favorites',
                            created: new Date().toISOString(),
                            lectures: oldNrs.map(String)
                        });
                        _save();
                        localStorage.removeItem(OLD_KEY);
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    function _save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            collections: _collections,
            nextId: _nextId
        }));
        _scheduleSyncToFirestore();
    }

    // ===== Firestore Sync =====
    function _getFirestore() {
        try {
            return firebase.firestore();
        } catch (e) {
            return null;
        }
    }

    function _userDocRef() {
        var fs = _getFirestore();
        if (!fs || !_userId) return null;
        return fs.collection('users').doc(_userId).collection('data').doc('favorites');
    }

    function _scheduleSyncToFirestore() {
        if (!_userId) return;
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(_syncToFirestore, SYNC_DEBOUNCE);
    }

    function _syncToFirestore() {
        var ref = _userDocRef();
        if (!ref) return;

        var payload = {
            collections: _collections,
            nextId: _nextId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        ref.set(payload).then(function () {
            _updateSyncIndicator('synced');
        }).catch(function (err) {
            console.error('[favorites] Firestore write failed:', err);
            _updateSyncIndicator('error');
        });
    }

    function _loadFromFirestore(userId) {
        _userId = userId;
        var ref = _userDocRef();
        if (!ref) return;

        _updateSyncIndicator('syncing');

        ref.get().then(function (doc) {
            if (!doc.exists) {
                // First login — push localStorage to Firestore
                _syncToFirestore();
                _updateSyncIndicator('synced');
                return;
            }
            var remote = doc.data();
            var remoteCols = remote.collections || [];
            var remoteNextId = remote.nextId || 1;

            // Merge: union of lectures per collection name
            _mergeCollections(remoteCols, remoteNextId);
            _save(); // saves merged to localStorage + triggers Firestore write
            _updateSyncIndicator('synced');

            // Refresh UI
            if (PPP.app && PPP.app.updateFavoritesCount) {
                PPP.app.updateFavoritesCount();
            }
        }).catch(function (err) {
            console.error('[favorites] Firestore read failed:', err);
            _updateSyncIndicator('error');
        });
    }

    function _mergeCollections(remoteCols, remoteNextId) {
        // Build map: name → {local collection}
        var localMap = {};
        _collections.forEach(function (c) { localMap[c.name] = c; });

        remoteCols.forEach(function (rc) {
            if (localMap[rc.name]) {
                // Merge lectures (union)
                var existing = localMap[rc.name];
                var set = {};
                existing.lectures.forEach(function (nr) { set[nr] = true; });
                rc.lectures.forEach(function (nr) { set[nr] = true; });
                existing.lectures = Object.keys(set);
            } else {
                // New collection from remote
                _collections.push({
                    id: _nextId++,
                    name: rc.name,
                    created: rc.created || new Date().toISOString(),
                    lectures: rc.lectures || []
                });
            }
        });

        // Ensure nextId is highest
        if (remoteNextId > _nextId) _nextId = remoteNextId;
    }

    function _updateSyncIndicator(state) {
        var el = document.getElementById('syncStatus');
        if (!el) return;
        el.className = 'sync-status sync-' + state;
        var titles = { syncing: 'Syncing...', synced: 'Synced', error: 'Sync error' };
        el.title = titles[state] || '';
        // Dot symbol for status
        var dots = { syncing: '\u25CB', synced: '\u25CF', error: '\u25C6' };
        el.textContent = dots[state] || '';
    }

    // ===== Auth Hooks (called by auth.js) =====
    function _onLogin(userId) {
        _loadFromFirestore(userId);
    }

    function _onLogout() {
        _userId = null;
        if (_syncTimer) clearTimeout(_syncTimer);
        var el = document.getElementById('syncStatus');
        if (el) el.style.display = 'none';
    }

    // ===== Collection CRUD =====
    function createCollection(name) {
        var col = {
            id: _nextId++,
            name: name.trim(),
            created: new Date().toISOString(),
            lectures: []
        };
        _collections.push(col);
        _save();
        return col;
    }

    function deleteCollection(id) {
        _collections = _collections.filter(function (c) { return c.id !== id; });
        _save();
    }

    function renameCollection(id, newName) {
        var col = _getById(id);
        if (col) { col.name = newName.trim(); _save(); }
    }

    function getCollections() {
        return _collections.map(function (c) {
            return { id: c.id, name: c.name, created: c.created, count: c.lectures.length };
        });
    }

    function _getById(id) {
        for (var i = 0; i < _collections.length; i++) {
            if (_collections[i].id === id) return _collections[i];
        }
        return null;
    }

    // ===== Lecture <-> Collection =====
    function addToCollection(id, nr) {
        var col = _getById(id);
        nr = String(nr);
        if (col && col.lectures.indexOf(nr) === -1) {
            col.lectures.push(nr);
            _save();
        }
    }

    function removeFromCollection(id, nr) {
        var col = _getById(id);
        nr = String(nr);
        if (col) {
            col.lectures = col.lectures.filter(function (n) { return n !== nr; });
            _save();
        }
    }

    function isInCollection(id, nr) {
        var col = _getById(id);
        return col ? col.lectures.indexOf(String(nr)) !== -1 : false;
    }

    function getCollectionLectures(id) {
        var col = _getById(id);
        return col ? col.lectures.slice() : [];
    }

    // ===== Backward-compatible API =====
    function isFavorite(nr) {
        nr = String(nr);
        for (var i = 0; i < _collections.length; i++) {
            if (_collections[i].lectures.indexOf(nr) !== -1) return true;
        }
        return false;
    }

    function getAll() {
        var set = {};
        _collections.forEach(function (c) {
            c.lectures.forEach(function (nr) { set[nr] = true; });
        });
        return Object.keys(set);
    }

    function count() { return getAll().length; }

    function toggle(nr) {
        nr = String(nr);
        if (_collections.length === 0) {
            createCollection('Favorites');
        }
        var col = _collections[0];
        var idx = col.lectures.indexOf(nr);
        if (idx !== -1) {
            col.lectures.splice(idx, 1);
        } else {
            col.lectures.push(nr);
        }
        _save();
        return col.lectures.indexOf(nr) !== -1;
    }

    function getCollectionsForLecture(nr) {
        nr = String(nr);
        return _collections.filter(function (c) {
            return c.lectures.indexOf(nr) !== -1;
        }).map(function (c) {
            return { id: c.id, name: c.name };
        });
    }

    _load();

    return {
        // Backward-compatible
        toggle: toggle,
        isFavorite: isFavorite,
        getAll: getAll,
        count: count,
        // Collections API
        createCollection: createCollection,
        deleteCollection: deleteCollection,
        renameCollection: renameCollection,
        getCollections: getCollections,
        addToCollection: addToCollection,
        removeFromCollection: removeFromCollection,
        isInCollection: isInCollection,
        getCollectionLectures: getCollectionLectures,
        getCollectionsForLecture: getCollectionsForLecture,
        // Auth hooks (called by auth.js)
        _onLogin: _onLogin,
        _onLogout: _onLogout
    };
})();
