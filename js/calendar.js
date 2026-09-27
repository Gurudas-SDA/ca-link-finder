/* ===========================================================================
   PPP Link Finder — Vaiṣṇava calendar data (Fāze 4, 2026-09-26)

   Only the DATA side of the calendar view: lazy load of
   data-static/ppp_calendar.json, the 4-week grid, and resolving an
   `event:<title>` search token to lecture numbers. Rendering lives in app.js
   (toggleCalendar / _renderCalendarPanel), SQL in search.js.

   Why lecture numbers come from this JSON and not from a `calendar` column
   in ppp_meta.db: the column is built by build_spa_databases.py, but the
   production DB has not been rebuilt with it yet. The JSON's `nrs` use the
   exact same semantics the column will have (calendar_label == this event
   OR nr in alsoNrs — see scripts/calendar/14_build_app_payload.py), so a
   later switch to `calendar_norm` changes no result.

   Rājan decisions (2026-09-23): 4 full weeks; appearance and disappearance
   stay separate days but both lead to ONE personality lecture set, split
   into "This day" / "About this personality"; Paran and fasting/period
   notes are shown but never have lectures.
   Rājan 2026-09-27: every personality day also COUNTS the whole set (an
   appearance with no lectures of its own still shows the entity's number).
   =========================================================================== */
window.PPP = window.PPP || {};

PPP.calendar = (function () {
    'use strict';

    // ?v= is rewritten by scripts/cache_bust.py (JS_REFS) so the service
    // worker precache key matches this exact request URL.
    var DATA_URL = 'data-static/ppp_calendar.json?v=5f348175';

    var WEEKS = 4;
    var _data = null;
    var _loading = null;
    var _byDate = {};      // 'YYYY-MM-DD' -> [event]
    var _bySlug = {};      // slug -> event
    var _byNorm = {};      // normalized title -> event
    var _todayOverride = null;

    function _norm(s) {
        var u = PPP.utils;
        s = String(s || '').toLowerCase();
        if (u && u.removeDiacritics) s = u.removeDiacritics(s);
        return s.replace(/\s+/g, ' ').trim();
    }

    var _entityNrs = {};   // slug -> [string] every lecture of the event's entity

    function _index(doc) {
        _byDate = {}; _bySlug = {}; _byNorm = {}; _entityNrs = {};
        (doc.events || []).forEach(function (ev) {
            _bySlug[ev.slug] = ev;
            _byNorm[_norm(ev.title)] = ev;
            (ev.dates || []).forEach(function (d) {
                (_byDate[d] = _byDate[d] || []).push(ev);
            });
        });
        // A personality is glorified on BOTH its appearance and disappearance
        // day (Rājan 2026-09-27), so every day of an entity counts and opens
        // the entity's whole lecture set — the same set lectureSet() returns.
        // Festivals / Ekādaśī are single-event entities, so for them this is
        // just their own nrs; notes (Paran, fasts) never get lectures.
        var ents = doc.entities || {};
        (doc.events || []).forEach(function (ev) {
            if (ev.note) { _entityNrs[ev.slug] = []; return; }
            var all = {};
            (ev.nrs || []).forEach(function (n) { all[String(n)] = true; });
            var e = ev.entitySlug && ents[ev.entitySlug];
            (e ? e.eventSlugs : []).forEach(function (s) {
                var sib = _bySlug[s];
                if (sib && !sib.note) (sib.nrs || []).forEach(function (n) { all[String(n)] = true; });
            });
            _entityNrs[ev.slug] = Object.keys(all);
        });
        // Within a day: events with lectures first (most lectures first),
        // then lecture-less events, then Paran / fasting notes last.
        Object.keys(_byDate).forEach(function (d) {
            _byDate[d].sort(function (a, b) {
                var na = a.note ? 1 : 0, nb = b.note ? 1 : 0;
                if (na !== nb) return na - nb;
                var la = lectureCount(a), lb = lectureCount(b);
                if ((la > 0) !== (lb > 0)) return lb > 0 ? 1 : -1;
                if (la !== lb) return lb - la;
                return a.title < b.title ? -1 : 1;
            });
        });
        _data = doc;
    }

    /** Lazy, single-flight load. Resolves to the payload; rejects on failure
     *  (and a later call retries). */
    function load() {
        if (_data) return Promise.resolve(_data);
        if (_loading) return _loading;
        _loading = fetch(DATA_URL).then(function (r) {
            if (!r.ok) throw new Error('calendar HTTP ' + r.status);
            return r.json();
        }).then(function (doc) {
            _index(doc);
            _loading = null;
            return doc;
        }, function (err) {
            _loading = null;
            throw err;
        });
        return _loading;
    }

    function isLoaded() { return !!_data; }

    /** Lectures behind a calendar cell: the whole entity set (see _index). */
    function lectureCount(ev) {
        var l = ev && _entityNrs[ev.slug];
        return l ? l.length : ((ev && ev.nrs) || []).length;
    }

    /** Lectures of this day itself (the event's own nrs, distinct). */
    function dayCount(ev) {
        var seen = {};
        ((ev && ev.nrs) || []).forEach(function (n) { seen[String(n)] = true; });
        return Object.keys(seen).length;
    }

    /**
     * True when the cell shows TWO counts (Rājan 2026-09-27): a personality
     * whose entity has more than one (non-note) day, e.g. appearance +
     * disappearance. Then "this day" (dayCount) and "whole personality"
     * (lectureCount) differ in meaning even when the numbers happen to match.
     * Festivals / Ekādaśī / single-day entities keep one count.
     */
    function hasPersonSet(ev) {
        if (!ev || ev.note || !ev.entitySlug || !_data) return false;
        var e = (_data.entities || {})[ev.entitySlug];
        if (!e) return false;
        var n = 0;
        (e.eventSlugs || []).forEach(function (s) { var sib = _bySlug[s]; if (sib && !sib.note) n++; });
        return n > 1;
    }

    // ---- dates (local calendar days, no time-zone arithmetic) ----------
    function _pad(n) { return (n < 10 ? '0' : '') + n; }
    function toISO(d) { return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
    function fromISO(iso) {
        var p = String(iso).split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    function todayISO() { return _todayOverride || toISO(new Date()); }
    function isPast(iso) { return iso < todayISO(); }

    /** Monday of the week containing `iso`. */
    function mondayOf(iso) {
        var d = fromISO(iso);
        var dow = (d.getDay() + 6) % 7;   // Mon=0 … Sun=6
        d.setDate(d.getDate() - dow);
        return toISO(d);
    }

    /**
     * 4 full weeks (28 days), Monday-first, starting with the Monday of the
     * week containing `today` (so the weekday of today never matters), shifted
     * by `offsetWeeks` (prev/next navigation moves by 4 weeks at a time).
     */
    function getGrid(today, offsetWeeks) {
        var t = today || todayISO();
        var start = fromISO(mondayOf(t));
        start.setDate(start.getDate() + 7 * (offsetWeeks || 0));
        var days = [];
        for (var i = 0; i < WEEKS * 7; i++) {
            var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            var iso = toISO(d);
            days.push({
                iso: iso,
                date: d,
                isPast: iso < t,
                isToday: iso === t,
                events: eventsForDate(iso)
            });
        }
        return days;
    }

    function eventsForDate(iso) { return (_byDate[iso] || []).slice(); }
    function getEvent(slug) { return _bySlug[slug] || null; }
    function eventTitle(slug) { var e = _bySlug[slug]; return e ? e.title : ''; }

    function entityEventSlugs(entitySlug) {
        var ents = (_data && _data.entities) || {};
        var e = ents[entitySlug];
        return e ? e.eventSlugs.slice() : [];
    }

    function range() { return (_data && _data.range) || null; }

    /**
     * Events an `event:` token value stands for: an exact (case- and
     * diacritics-insensitive) title match wins; otherwise every event whose
     * title contains the value (so a typed `event:janmastami` still works).
     */
    function resolveToken(value) {
        var n = _norm(value);
        if (!n || !_data) return [];
        if (_byNorm[n]) return [_byNorm[n]];
        return (_data.events || []).filter(function (ev) {
            return !ev.note && _norm(ev.title).indexOf(n) !== -1;
        });
    }

    /**
     * Lecture numbers for a list of `event:` token values, plus the
     * "This day" / "About this personality" split (Rājan 2026-09-23).
     * With exactly ONE resolved event the set is the whole personality set
     * (every event of its entity: appearance + disappearance + …), and
     * dayNrs marks the lectures of the clicked day itself. With several
     * resolved events it is their plain union, unsplit.
     * Returns { nrs: [string], dayNrs: {nr: true} | null, event: ev | null }.
     */
    function lectureSet(values) {
        var evs = [];
        (values || []).forEach(function (v) {
            resolveToken(v).forEach(function (ev) { if (evs.indexOf(ev) === -1) evs.push(ev); });
        });
        var all = {};
        function add(ev) { (ev.nrs || []).forEach(function (n) { all[String(n)] = true; }); }
        if (evs.length === 1) {
            var ev = evs[0];
            var day = {};
            (ev.nrs || []).forEach(function (n) { day[String(n)] = true; });
            // Same set the calendar cell counts (lectureCount).
            return { nrs: (_entityNrs[ev.slug] || []).slice(), dayNrs: day, event: ev };
        }
        evs.forEach(add);
        return { nrs: Object.keys(all), dayNrs: null, event: null };
    }

    return {
        load: load,
        isLoaded: isLoaded,
        lectureCount: lectureCount,
        dayCount: dayCount,
        hasPersonSet: hasPersonSet,
        getGrid: getGrid,
        mondayOf: mondayOf,
        todayISO: todayISO,
        isPast: isPast,
        toISO: toISO,
        fromISO: fromISO,
        eventsForDate: eventsForDate,
        getEvent: getEvent,
        eventTitle: eventTitle,
        entityEventSlugs: entityEventSlugs,
        resolveToken: resolveToken,
        lectureSet: lectureSet,
        range: range,
        WEEKS: WEEKS,
        // Internal (test only): pin "today" so grid/past assertions do not
        // depend on the day the suite runs. null restores the real date.
        _setTodayForTest: function (iso) { _todayOverride = iso || null; }
    };
})();
