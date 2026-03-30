/* ===========================================================================
   PPP Link Finder — Favorites (localStorage-backed)
   Toggle star per lecture, persist across sessions.
   =========================================================================== */
window.PPP = window.PPP || {};

PPP.favorites = (function () {
    'use strict';

    var STORAGE_KEY = 'ppp_favorites';
    var _set = new Set();

    function _load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                JSON.parse(raw).forEach(function (nr) { _set.add(String(nr)); });
            }
        } catch (e) { /* ignore corrupt data */ }
    }

    function _save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(_set)));
    }

    function toggle(nr) {
        nr = String(nr);
        if (_set.has(nr)) { _set.delete(nr); } else { _set.add(nr); }
        _save();
        return _set.has(nr);
    }

    function isFavorite(nr) { return _set.has(String(nr)); }
    function getAll() { return Array.from(_set); }
    function count() { return _set.size; }

    _load();

    return { toggle: toggle, isFavorite: isFavorite, getAll: getAll, count: count };
})();
