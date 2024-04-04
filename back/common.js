/*
 * Copyright 2011-2022 Abierto Networks, LLC.
 * All rights reserved.
 */

/* global $, ABCONST, Custom, moment, PLATFORM, SERVER_URL, QUERY_INTERVAL, webOS */

/* eslint-disable-next-line */
var ABNET = (function () {
    var DEVICE_NAME = 'devel-app-' + ABCONST.APP_ID;
    var DEVICE_LOCATION = 'devel-app-' + ABCONST.APP_ID;
    var DEVICE_COMPANY = 'Abierto';
    var UPDATE_URL = SERVER_URL + '/update';
    var MANAGEMENT_URL = SERVER_URL + '/management';
    var PREVIEW_URL = SERVER_URL + '/ajax/getpreviewdata';
    var DEFAULT_QUERY_INTERVAL = 600 * 1000; // 600 seconds, i.e. 10 minutes
    var IDENTITY_CHECK_INTERVAL = DEFAULT_QUERY_INTERVAL;
    var MANAGEMENT_INTERVAL = DEFAULT_QUERY_INTERVAL;
    var DAYPARTTIMER;
    var APPTIMER;
    var DOWNLOADED = {};
    var SHEETZ_KIOSK = 10;

    var client = getClient();
    var prefix = 'prod';

    if (client === 'dev' || client === 'qa' || client === 'qa1' || client === 'dce2') {
        prefix = 'dev';
    }

    if (client === 'dce2') {
        PREVIEW_URL = SERVER_URL + '/ajax/getpreviewdata';
    }

    // screenshot PUT URL
    var SCREENSHOT_URL = 'https://img.support.' + prefix + '.ab-net.us/save';
    var SCREENSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
    // websocket interface
    var WEBSOCKET_URL = 'wss://ws.support.' + prefix + '.ab-net.us';
    var WEBSOCKET_INTERVAL = 10 * 1000; // 10 seconds
    // Parseable logging
    var PARSEABLE_URL = 'https://logging.abierto-support.com/api/v1/logstream/';
    var PARSEABLE_USER = 'abiertodev';
    var PARSEABLE_PASSWORD = 'dnH(vq+6f';

    // video wall constants
    var WEBOS_SERVICE = 'luna://com.lg.app.signage.customsyncservice/';
    var SERVICE_TIMEOUT = 20;                // Time to wait for sync service to start
    var PORT_NUM = 14726;                   // Port number for websocket
    var VID_PORT_1 = 14721;                 // Port number for sync video tag 1
    var VID_PORT_2 = 14722;                 // Port number for sync video tag 2
    var WAITING_MASTER_DURATION = 10000;    // Interval for try to reconnect to Master
    var MASTER_IP = '192.168.200.164';      // Only used when running locally

    // Daypart constants
    var PLAYWHEN = {
        DAILY: 1,
        WEEKLY: 2,
        MONTHLY: 3
    };

    /**
     * NOTE
     * Add a "var QUERY_INTERVAL = 10;" line to back/server.js to change the query interval
     * to 10 seconds.  We're doing this on development servers: local,
     * dev.cms and qa.cms, and also on demo.cms.
     */
    if (typeof QUERY_INTERVAL !== 'undefined') {
        IDENTITY_CHECK_INTERVAL = QUERY_INTERVAL * 1000;
        MANAGEMENT_INTERVAL = QUERY_INTERVAL * 1000;
    }

    var debug = {};

    debug.getHeader = function () {
        return {
            'Authorization': 'Basic ' + btoa(PARSEABLE_USER + ':' + PARSEABLE_PASSWORD)
        };
    };

    debug.getMac = function () {
        var macAddress = localStorage.getItem('mac');

        if (!macAddress) {
            macAddress = localStorage.getItem('deviceLocation');
        }

        return macAddress.toLowerCase();
    };

    debug.create = function () {
        var macaddress = this.getMac();
        var log = 'devicelog' + macaddress;
        var url = PARSEABLE_URL + log;

        $.ajax({
            url: url,
            type: 'PUT',
            headers: this.getHeader(),
            processData: false
        });
    };

    debug.toggle = function () {
        var logging = localStorage.getItem('logging');

        if (!logging || logging === 'false') {
            localStorage.setItem('logging', 'true');
            this.create();
        }
        else {
            localStorage.setItem('logging', 'false');
        }
    };

    // accepts any number of args that can be strings, objects or arrays
    debug.log = function (arg1, arg2, arg3, arg4) {
        arg1 = arg1 || '';
        arg2 = arg2 || '';
        arg3 = arg3 || '';
        arg4 = arg4 || '';

        var args = [arg1, arg2, arg3, arg4];

        // don't log anything when running in preview mode
        if (isPreviewMode()) {
            return;
        }

        var logging = localStorage.getItem('logging');
        // don't log anything when logging is disabled
        if (!logging || logging === 'false') {
            return;
        }

        var message = [];

        // format args to message
        args.forEach(function(arg) {
            if (typeof arg === 'object') {
                message.push(JSON.stringify(arg));
            }
            else if (arg) {
                message.push(arg);
            }
        });

        message = message.join(' ');

        var name = localStorage.getItem('deviceLocation');
        var macaddress = this.getMac();
        var log = 'devicelog' + macaddress;
        var url = PARSEABLE_URL + log;

        var data = {
            client: getClient(),
            datetime: moment().format(),
            macaddress: macaddress,
            name: name,
            message: message
        };

        $.ajax({
            url: url,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            headers: this.getHeader(),
            processData: false
        });
    };

    /**
     * Call server to get preview data.
     *
     * @returns {undefined}
     */
    var getPreviewData = function(displayid, callback) {
        $.ajax({
            url: PREVIEW_URL + '?api=3&appid=' + ABCONST.APP_ID + '&displayid=' + displayid,
            cache: false,
            dataType: 'json',
            /* eslint-disable-next-line */
            success: function (data, status, request) {
                installUpdates(data);

                if (callback && typeof callback === 'function') {
                    callback(data);
                }
            },
            error: function (request, status, error) {
                console.log(request, status, error);
            }
        });
    };

    /**
     * Call server to check for content updates.
     *
     * @returns {undefined}
     */
    var checkUpdates = function (callback) {
        var location = localStorage.getItem('deviceLocation');
        var version = localStorage.getItem('version') || ABCONST.version || null;
        var av = localStorage.getItem('appVersion');

        if (version === null) {
            version = '0.0.0';
            localStorage.setItem('version', version);
        }

        var url = UPDATE_URL + '?api=2&l=' + location + '&a=' + ABCONST.APP_ID + '&v=' + version + '&av=' + av;

        debug.log('checkUpdates:', url);

        $.ajax({
            url: url,
            dataType: 'json',
            /* eslint-disable-next-line */
            success: function (data) {
                debug.log('checkUpdates success:', data);
                installUpdates(data);

                if (callback && typeof callback === 'function') {
                    callback(data);
                }
            },
            error: function (request, status, error) {
                debug.log('checkUpdates error:', request, status, error);
            }
        });
    };

    var fakeCheckUpdates = function (uniqueid, callback) {
        var location = uniqueid;
        var version = localStorage.getItem('version') || ABCONST.version || null;
        var av = localStorage.getItem('appVersion');

        if (version === null) {
            version = '0.0.0';
            localStorage.setItem('version', version);
        }

        var url = UPDATE_URL + '?api=2&l=' + location + '&a=' + ABCONST.APP_ID + '&v=' + version + '&av=' + av;

        debug.log('fakeCheckUpdates:', url);

        $.ajax({
            url: url,
            dataType: 'json',
            /* eslint-disable-next-line */
            success: function (data) {
                debug.log('fakeCheckUpdates success:', data);
                installUpdates(data);

                if (callback && typeof callback === 'function') {
                    callback(data);
                }
            },
            error: function (request, status, error) {
                debug.log('fakeCheckUpdates error:', request, status, error);
            }
        });
    };

    /**
     * Save update to localStorage if something new was received from server.
     *
     * @param {type} data
     * @returns {undefined}
     */
    var installUpdates = function (data) {
        var updated = false;
        var length = data.length;

        for (var i = 0; i < length; ++i) {
            var update = data[i];
            var name = update.name;
            var value = update.value;

            var old = localStorage.getItem(name);

            localStorage.setItem(name, value);

            if (old !== value) {
                updated = true;

                if (name === 'playlists') {
                    localStorage.setItem('lastdownload', old);
                }
            }

            if (name === 'version' && old === '0.0.0') {
                localStorage.setItem('justversion', 'true');
                ABCONST.version = value;
            }
            else if (name === 'version' && old !== '0.0.0') {
                localStorage.setItem('justversion', 'false');
            }
        }

        if (updated) {
            debug.log('installUpdates updated:', data);
            closeDaypartsGaps();
            debug.log('installUpdates triggered content:changed');
            $(document).trigger('content:changed');
        }
    };

    /**
     * Close gaps between dayparts.
     *
     * This applies only to daily dayparts.  We are permissive in the CMS and allow daily daypart
     * configurations that don't cover the full 24 hours of a day.  On screens this could result
     * in periods of time when there is nothing to display.  To prevent this we "close" the gaps
     * by extending the daypart before a gap to the beginning of the daypart following the gap.
     * Note that this does not change the daypart configuration on the CMS.
     */
    function closeDaypartsGaps() {
        debug.log('closeDaypartsGaps');

        var stored = localStorage.getItem('dayparts');
        var dayparts = jsonParse(stored);
        var daily = [];
        var latest = moment('00:00', 'HH:mm');

        $.each(dayparts, function(unused, daypart) {
            if (daypart.playwhen === PLAYWHEN.DAILY) {
                daily.push(daypart);
            }
        });

        // For each daily daypart, look at the beginning of the following daypart.
        // The current daypart's end time is extended IFF the following daypart's begin time:
        // - is STRICTLY AFTER the current daypart's end time
        // - AND it is NOT BEFORE "latest"
        // where "latest" is the latest end time we've seen, in any daypart.
        //
        // Sane cases are straightforward:
        // DP1 04:00-08:00, DP2 09:00-10:00
        // Here DP1 is changed to 04:00-09:00
        //
        // This also deals with admittedly convoluted setups, that mix gaps and overlaps:
        // DP1 04:00-13:00, DP2 06:00-10:00, DP3 12:00-18:00
        // Here the gap between DP2 and DP3 (from 10:00 to 12:00) is NOT closed
        // because it is covered by DP1.
        $.each(daily, function(index, daypart) {
            var next = index < (daily.length - 1) ? daily[index + 1] : daily[0];
            var selfEnd = moment(daypart.playto, 'HH:mm');
            var nextBegin = moment(next.playfrom, 'HH:mm');

            if (nextBegin.isBefore(latest)) {
                return true; // continue
            }

            latest = selfEnd;

            if (nextBegin.isAfter(selfEnd)) {
                daypart.playto = next.playfrom;
            }
        });

        var updated = JSON.stringify(dayparts);

        if (stored !== updated) {
            localStorage.setItem('dayparts', updated);
        }
    }

    /**
     * Takes a slide object, and renders either a div.page, div.video or image.slide
     *
     * @param {type} slide
     * @param {type} slideClass
     * @returns {string} the rendered html
     */
    function renderSlide(slide, slideClass) {
        var file = slide.path + '/' + slide.name;
        var type = getFileExt(file);
        var uri = encode(file);
        var time = slide.duration || ABCONST.SLIDE_DURATION || '';
        var style = ' style="visibility: hidden;"';
        var html = '';

        switch (type) {
            case 'mp4':
            case 'webm':
                html += '<div data-src="' + uri + '" class="video slide ' + slideClass + '" data-duration="' + time + '" ' + style + '></div>';
                break;
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
                html += '<img src="' + uri + '" class="slide ' + slideClass + '" data-duration="' + time + '" ' + style + '>';
                break;
            default:
                break;
        }

        return html;
    }

    /**
     * Takes a filename (which can include a subdirectory) and returns
     * it as a URI encoded string. The string is double encoded for WEBOS
     * and not encoded for TIZEN
     *
     * @param {type} file
     * @returns {string} the encoded string
     */
    function encode(file) {
        if (PLATFORM.NAME === 'WEBOS' || PLATFORM.NAME === 'ABNET') {
            return encodeURI(encodeURI(file));
        }
        else if (PLATFORM.NAME === 'TIZEN') {
            return file;
        }
        else {
            return encodeURI(file);
        }
    }

    /**
     * Determines which daypart should be showing NOW and then sets a timeout for how long
     * that daypart should be shown by using the dayparts playto value or an overlapping
     * weekly or monthly daypart playfrom value (whichever comes first). Once the timeout
     * expires, Daypart3 is reinitialized which forces it to choose to the next daypart that
     * should be showing and so on.
     *
     * Daypart3 triggers 'daypart:showslide' when a new daypart is shown, with a param which is
     * the id of the daypart just shown.
     *
     * @param {type} dayparts
     * @returns {undefined}
     */
    var Daypart3 = function (dayparts, videowall) {
        debug.log('Daypart3 - videowall:', videowall);

        var NOW = moment();
        var DAYOFWEEK = (NOW.day() + 1).toString();
        var DAYOFMONTH = NOW.date().toString();
        var CURRENTINDEX = 0;
        var NEXT = null;
        var MIN_SAFE_INTEGER = -0x1FFFFFFFFFFFFF;
        var VIDEOWALL = videowall;

        init();

        function init() {
            setDaypartIndex();
            showDaypart();
        }

        /**
         * Sets CURRENTINDEX to the index (into the dayparts array) of the daypart that should be displaying NOW
         */
        function setDaypartIndex() {
            // NOTE: We're using the array of daypart objects stored in localStorage here, not the
            // jQuery dayparts collection used in other places in this file.
            var dayparts = jsonParse(localStorage.getItem('dayparts'));
            var monthly = [];
            var weekly = [];
            var daily = [];
            var selected = 0;

            // Put the dayparts in three buckets based on the daypart's type.  In the process
            // discard the dayparts that cannot be active NOW:
            // - monthly and weekly that fall on a day which is not today
            // - any type that doesn't include NOW
            // Also adds the index into the dayparts array to the actual dayparts objects.
            // Once this is done the monthly, weekly and daily arrays will hold only dayparts
            // that COULD be shown NOW.
            $.each(dayparts, function(index, daypart) {
                daypart.index = index;

                switch (daypart.playwhen) {
                    case PLAYWHEN.DAILY:
                        if (daypartIsNow(daypart)) {
                            daily.push(daypart);
                        }
                        break;
                    case PLAYWHEN.WEEKLY:
                        if (daypartIsToday(daypart) && daypartIsNow(daypart)) {
                            weekly.push(daypart);
                        }
                        break;
                    case PLAYWHEN.MONTHLY:
                        if (daypartIsToday(daypart) && daypartIsNow(daypart)) {
                            monthly.push(daypart);
                        }
                        break;
                }
            });

            // Order below is important because it reflects the priority: monthly > weekly > daily.
            // - If monthlies were found, one will be used, and the weeklies and dailies will be discarded.
            // - Else, if weeklies were found, one will be used, and the dailies will be discarded.
            // - Else, if dailies were found, one will be used.
            // - Else, i.e. none were found, is imposible, we're closing the gaps
            if (monthly.length > 0) {
                selected = resolveDaypartsOverlap(monthly);
            }
            else if (weekly.length > 0) {
                selected = resolveDaypartsOverlap(weekly);
            }
            else if (daily.length > 0) {
                selected = resolveDaypartsOverlap(daily);
            }
            else {
                // we never get here since we're closing the gaps
            }

            // set the current index
            CURRENTINDEX = selected;

            /**
             * Find if a daypart could be shown today.
             * - Dailies are always eligible.
             * - Weeklies are eligible only if today's day of week matches one of the daypart's day of week.
             * - Monthlies are eligible only if today's day of month matches the daypart's day of month.
             *
             * @param {*} daypart
             * @returns
             */
            function daypartIsToday(daypart) {
                if (daypart.playwhen === PLAYWHEN.WEEKLY) {
                    var playon = daypart.playon.toString().split('');

                    return playon.indexOf(DAYOFWEEK) !== -1;
                }

                if (daypart.playwhen === PLAYWHEN.MONTHLY) {
                    return daypart.playon === DAYOFMONTH;
                }

                return false;
            }

            /**
             * Find if a daypart could be shown NOW.
             * - A "normal" daypart, i.e. the start time is before the end time, could be shown
             * if NOW is between the start time and the end time.
             * - A daypart that spans midnight, i.e. the start time is before the end time, could be
             * shown if NOW is either after the start time, or before the end time.
             *
             * @param {*} daypart
             * @returns
             */
            function daypartIsNow(daypart) {
                var from = moment(daypart.playfrom, 'HH:mm');
                var to = moment(daypart.playto, 'HH:mm');

                if (from.isBefore(to)) {
                    return NOW.isBetween(from, to);
                }

                // daypart spans midnight
                return NOW.isAfter(from) || NOW.isBefore(to);
            }

            /**
             * Resolve overlapping dayparts.  The filtered array holds dayparts of the same type.
             * When dayparts overlap, the one with the more recent start time in the past is selected;
             * i.e. the previous daypart's end is "hidden" by the following daypart's start.
             *
             * @param {*} filtered
             * @returns
             */
            function resolveDaypartsOverlap(filtered) {
                if (filtered.length === 0) {
                    return 0;
                }

                var min = MIN_SAFE_INTEGER;
                var selected = 0;

                filtered.forEach(function(daypart) {
                    var from = moment(daypart.playfrom, 'HH:mm');
                    var to = moment(daypart.playto, 'HH:mm');

                    // If this daypart spans midnight (end time is before begin time) we need to adjust it
                    // so that it includes NOW.  What we need to do depends on where NOW falls relative to midnight:
                    // - if NOW is before midnight, to needs to be tomorrow
                    // - if NOW is after midnight, from needs to be yesterday
                    if (to.isBefore(from)) {
                        to.add(1, 'day');

                        if (NOW.isBefore(from)) {
                            from.subtract(1, 'day');
                            to.subtract(1, 'day');
                        }
                    }

                    var diff = from.diff(NOW);

                    if (diff > min) {
                        min = diff;
                        selected = daypart.index;
                    }
                });

                return selected;
            }
        }

        /**
         * Shows the daypart at CURRENTINDEX and sets DAYPARTTIMER
         */
        function showDaypart() {
            // get the current daypart
            var daypart = $(dayparts.get(CURRENTINDEX));

            debug.log('Daypart3 showDaypart triggered: daypart:showslide: ', daypart.attr('id'));
            // let the app know about the daypart switch
            $(document).trigger('daypart:showslide', daypart.attr('id'));

            // hide all the dayparts
            $(dayparts).hide();

            // show the current daypart
            daypart.show();

            // calculate how long the daypart should be shown
            var howLong = timeToWait();

            // start the timer
            DAYPARTTIMER = setTimeout(nextDaypart, howLong);
        }

        /**
         * setTimeout handler, clears DAYPARTTIMER and reinitializes Daypart3
         */
        function nextDaypart() {
            // timer expired, clearTimeout
            clearTimeout(DAYPARTTIMER);

            // reinitialize Daypart3
            if (VIDEOWALL) {
                // FIXME: this is an ugly hack, we should find a better solution.
                debug.log('Daypart3 nextDaypart videowall PLATFORM.reboot()');
                PLATFORM.reboot();
            }
            else {
                Daypart3($('.dayparts'), VIDEOWALL);
            }
        }

        /**
         * Determine how long the current daypart is to be shown on screen.  This works
         * by putting together three lists of "candidates", i.e. dayparts (other than self)
         * that have a start time between NOW and the end time of self.  The reason for the three
         * lists is to deal with priorities: e.g. if we have two candidates, one weekly and the
         * other daily, we'll pick the weekly even if its start time is later than the daily's.
         *
         * If we end up with two candidates of the same type (which could happen when there are
         * overlaps), we'll just pick the earliest start time.
         *
         * Higher priority dayparts are not interupted by lower priority dayparts.  E.g. if the
         * current daypart is a weekly, and there is a daily with a start time before the end
         * time of the current, then the current will run to its completion.
         *
         * @returns int Time to run, in milliseconds
         */
        function timeToWait() {
            // NOTE: We're using the array of daypart objects stored in localStorage here, not the
            // jQuery dayparts collection used in other places in this file.
            var dayparts = jsonParse(localStorage.getItem('dayparts'));
            var current = dayparts[CURRENTINDEX];
            var monthly = [];
            var weekly = [];
            var daily = [];

            // need to set this now so daypartIsEligible() works
            current.from = moment(current.playfrom, 'HH:mm');
            current.to = moment(current.playto, 'HH:mm');

            // If the current daypart spans midnight (end time is before begin time) we need to adjust it
            // so that it includes NOW.  What we need to do depends on where NOW falls relative to midnight:
            // - if NOW is before midnight, current.to needs to be tomorrow
            // - if NOW is after midnight, current.from needs to be yesterday
            if (current.to.isBefore(current.from)) {
                current.to.add(1, 'day');

                if (NOW.isBefore(current.from)) {
                    current.from.subtract(1, 'day');
                    current.to.subtract(1, 'day');
                }
            }

            // put eligible dayparts in priority buckets
            $.each(dayparts, function(index, daypart) {
                if (index == CURRENTINDEX) {
                    return true; // continue;
                }

                daypart.index = index;
                daypart.from = moment(daypart.playfrom, 'HH:mm');

                // daypart would have already started today, so we should consider when it will start tomorrow
                if (daypart.from.isBefore(NOW)) {
                    daypart.from.add(1, 'day');
                }

                switch (daypart.playwhen) {
                    case PLAYWHEN.DAILY:
                        if (daypartIsEligible(daypart)) {
                            daily.push(daypart);
                        }
                        break;
                    case PLAYWHEN.WEEKLY:
                        if (daypartIsEligible(daypart)) {
                            weekly.push(daypart);
                        }
                        break;
                    case PLAYWHEN.MONTHLY:
                        if (daypartIsEligible(daypart)) {
                            monthly.push(daypart);
                        }
                        break;
                }
            });

            var result = duration();

            consoleLog(result);

            return result;

            /**
             * A daypart is eligible to be shown on screen if:
             * - its start time is between NOW and the current daypart's end time, inclusive
             * - and, if weekly or monthly, the current daypart's end time matches the day of week
             *   or the day of month
             *
             * @param {*} daypart
             * @returns
             */
            function daypartIsEligible(daypart) {
                var eligible = daypart.from.isBetween(NOW, current.to, undefined, '[]');

                if (daypart.playwhen === PLAYWHEN.DAILY) {
                    return eligible;
                }

                if (daypart.playwhen === PLAYWHEN.WEEKLY) {
                    // moment.js days of week are Sunday 0 through Saturday 6
                    // we store strings, Sunday "1" through Saturday "7"
                    var dayofweek = (current.to.day() + 1).toString();
                    var playon = daypart.playon.toString().split('');

                    return eligible && playon.indexOf(dayofweek) !== -1;
                }

                if (daypart.playwhen === PLAYWHEN.MONTHLY) {
                    // moment.js days of month are numbers, we store strings
                    var dayofmonth = current.to.date().toString();

                    return eligible && daypart.playon === dayofmonth;
                }

                return false;
            }

            /**
             * Compute the length of time, in milliseconds, that the current daypart will show.
             * This is the difference between the earliest start time of any daypart the COULD
             * interrupt the current one, and the current time, NOW.
             *
             * The dayparts that COULD interrupt the current one are those dayparts that:
             * - have a start time beween NOW and the end time of the current daypart (i.e. the
             * daypartIsEligible() function returns true)
             * - AND are of the same or higher priority as the current one
             *
             * The second condition ensures that a higher priority daypart is not interrupted by
             * a lower priority daypart.  E.g. DP-WEEKLY 08:00-13:00, DP-DAILY 12:00-18:00,
             * DP-WEEKLY runs until 13:00.
             *
             * If there are no dayparts that COULD interrupt the current one, then the
             * current daypart runs to its completion.
             *
             * @returns int Number of milliseconds
             */
            function duration() {
                var end = current.to;

                // order in the if/else statements below is important,
                // it enforces the monthly > weekly > daily priority
                switch (current.playwhen) {
                    case PLAYWHEN.DAILY:
                        if (monthly.length) {
                            NEXT = monthly[0];
                        }
                        else if (weekly.length) {
                            NEXT = weekly[0];
                        }
                        else if (daily.length) {
                            NEXT = daily[0];
                        }
                        break;
                    case PLAYWHEN.WEEKLY:
                        if (monthly.length) {
                            NEXT = monthly[0];
                        }
                        else if (weekly.length) {
                            NEXT = weekly[0];
                        }
                        break;
                    case PLAYWHEN.MONTHLY:
                        if (monthly.length) {
                            NEXT = monthly[0];
                        }
                        break;
                }

                if (NEXT) {
                    end = NEXT.from;
                }

                return end.valueOf() - NOW.valueOf() + 100;
            }
        }

        // takes milliseconds and console logs it as hours/minutes/seconds for debugging
        function consoleLog(howLong) {
            var temp = moment.duration(howLong);
            var hours = temp.hours();
            var minutes = temp.minutes();
            var seconds = temp.seconds();
            var message = '';

            if (hours) {
                message += hours + ' hours ';
            }

            message += minutes + ' minutes ';
            message += seconds + ' seconds ';
            message += 'until the next daypart switch';

            if (NEXT) {
                message += ' (' + NEXT.name + ', from ' + NEXT.playfrom + ' to ' + NEXT.playto + ')';
            }

            console.log(message);
            debug.log(message);
        }
    };


    /**
     * This is used only in NextGenApp.renderApp.
     *
     * @param {type} slides
     * @returns {undefined}
     */
    var renderDaypart = function (daypart) {
        var id = 'daypart-' + daypart.id;
        var playfrom = daypart.playfrom;
        var playto = daypart.playto;
        var playwhen = daypart.playwhen;
        var playon = daypart.playon;
        var html = '';

        html += '<div id="' + id + '" class="dayparts" data-playfrom="' + playfrom + '" ';
        html += 'data-playto="' + playto + '" data-playwhen="' + playwhen + '" data-playon="' + playon + '"></div>';

        return html;
    };

    /**
     * FIXME: comment this.
     *
     * @param {type} url
     * @returns {unresolved}
     */
    var getAllUrlParams = function (url) {
        var queryString = url ? url.split('?')[1] : window.location.search.slice(1);
        var obj = {};

        if (queryString) {
            queryString = queryString.split('#')[0];

            var arr = queryString.split('&');

            for (var i = 0; i < arr.length; i++) {
                var a = arr[i].split('=');
                var paramName = a[0];
                var paramValue = typeof (a[1]) === 'undefined' ? true : a[1];

                if (paramName === '') {
                    continue;
                }
                else if (paramName.match(/\[(\d+)?\]$/)) {
                    var key = paramName.replace(/\[(\d+)?\]/, '');

                    if (!obj[key]) {
                        obj[key] = [];
                    }

                    if (paramName.match(/\[\d+\]$/)) {
                        var index = /\[(\d+)\]/.exec(paramName)[1];
                        obj[key][index] = paramValue;
                    }
                    else {
                        obj[key].push(paramValue);
                    }
                }
                else {
                    if (!obj[paramName]) {
                        paramValue = paramValue.replace(/\+/g, '%20');
                        obj[paramName] = decodeURIComponent(paramValue);
                    }
                    else if (obj[paramName] && typeof obj[paramName] === 'string') {
                        obj[paramName] = [obj[paramName]];
                        obj[paramName].push(paramValue);
                    }
                    else {
                        obj[paramName].push(paramValue);
                    }
                }
            }
        }

        return obj;
    };

    /**
     * Get extension from file name, dot not included.  Handles only 'filename.extension'.
     * Does NOT handle cases like 'filename', 'filename.', '.filename', maybe others.
     *
     * @param {String} name File name; may be path
     * @returns {String} Extension, without the dot
     */
    var getFileExt = function (name) {
        return name.split('.').pop();
    };

    /**
     * jsonParse: safely parse json
     * @param {type} json
     * @returns parsed json or null
     */
    function jsonParse(data) {
        try {
            return JSON.parse(data);
        }
        catch (e) {
            return null;
        }
    }

    /**
     * FIXME: comment
     *
     * @param {type} message
     * @returns {undefined}
     */
    function onScreenLog(message) {
        var onscreen = document.getElementById('onscreen-log');

        if (!onscreen) {
            var style = [
                'position: absolute;',
                'top: 0;',
                'left: 0;',
                'height: 100%;',
                'width: 30%;',
                'background-color: yellow;',
                'z-index: 1999;'
            ];

            $('body').append('<div id="onscreen-log" style="' + style.join(' ') + '"></div>');
        }

        $('#onscreen-log').prepend('<div>' + message + '</div>');
        console.log(message);
    }

    // FIXME: this is used ONLY in app 10
    function currency(value, options) {
        if (isNaN(value)) {
            return value;
        }

        var amount = parseFloat(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
        var symbol = '$';
        var post = false; // currency symbol after amount

        if (options === undefined) {
            return symbol + amount;
        }
        else {
            if (options.cents !== undefined && options.cents === 'cents') {
                if (amount < 1.00) {
                    amount = Number.parseInt(amount * 100);
                    symbol = '&cent;';
                    post = true;
                }
            }

            if (options.symbol !== undefined && options.symbol === 'top') {
                symbol = '<sup style="font-size: 50%;">' + symbol + '</sup>';
            }

            if (post) {
                return amount + symbol;
            }
            else {
                return symbol + amount;
            }
        }
    }

    // FIXME: this is used ONLY in app 10
    var getPlaylist = function (fileNamesOnly) {
        fileNamesOnly = fileNamesOnly || false;

        var slides = [];
        var dayparts = jsonParse(localStorage.getItem('dayparts'));
        var playlists = jsonParse(localStorage.getItem('playlists'));

        if (!dayparts || !playlists) {
            return slides;
        }

        dayparts.forEach(function (daypart) {
            var playlist = playlists[daypart.id];

            playlist.forEach(function (slide) {
                var theSlide = null;

                if (fileNamesOnly) {
                    theSlide = slide.path + '/' + slide.name;
                }
                else {
                    theSlide = slide;
                }

                // only push theSlide if it hasn't already been added to the array
                if (slides.indexOf(theSlide) === -1) {
                    slides.push(theSlide);
                }
            });
        });

        return slides;
    };

    function validatePrice(input) {
        return /^\$?[0-9]+\.?[0-9]?[0-9]?$/.test(input);
    }

    /**
     * Polyfill/replacement for Array.isArray()
     */
    function isArray(arg) {
        return Object.prototype.toString.call(arg) === '[object Array]';
    }

    /**
     * @function isPreviewMode
     * @description returns true if app is running in a preview window iframe
     * otherwise returns false
     */
    function isPreviewMode() {
        // if app is running as a preview, params.page will be set
        var params = getAllUrlParams(window.location.href);

        if (params && params.page && params.slideshow) {
            return false;
        }

        if (params && params.page) {
            return true;
        }

        // otherwise app is running on device
        return false;
    }

    /**
     * @function Playlist3
     * @description A playlist function that can be initialized multiple times with 'new'. After
     * initializing the playlist, it can be loaded with a list of slides and (optionally) pages.
     * If only slides are loaded, the list will only show the slides. If slides AND pages are
     * loaded, the list will start with the first page, then show the first slide and so on.
     * Example usage:
     *    var playlist1 = new Playlist3();
     *    playlist1.load($('.slide'));
     *    playlist1.start();
     *
     * If the list of slides to be shown will include videos, Playlist3 should be initialized
     * with the 'players' option. The players will be bound to the instance of Playlist3. For
     * example, to initialize a Playlist3() with 2 video tags (video-1 and video-2):
     *     var playlist1 = new Playlist3({ players: [1, 2] });
     *
     * Complex Example, a Playlist3() to handle a slideshow with videos and another Playlist3()
     * to handle a list of pages and slides (no videos):
     *     var slidelist = new Playlist3({ players: [1, 2] });
     *     var pagelist = new Playlist3();
     *
     *     slidelist.load($('.innerslide'));
     *     pagelist.load($('.slide'), $('.page'));
     *
     *     slidelist.start();
     *     pagelist.start();
     *
     * EVENTS: every time Playlist3 starts to show a slide, page or video, a custom event is
     * triggered on the document. The events to listen for are as follows:
     *
     * 'playlist3:showvideo' a video slide has started playing, triggered with the slide index number
     * 'playlist3:showpage' a 'page' slide has started showing, triggered with the page index number
     * 'playlist3:showslide' an image slide has started showing, triggered with the slide index number
     * 'playlist3:play' the play button on the playlist controls has been clicked
     * 'playlist3:pause' the pause button on the playlist controls has been clicked
     * 'playlist3:next' the next button on the playlist controls has been clicked
     * 'playlist3:previous' the previous button on the playlist controls has been clicked
     * 'playlist3:showControls' the show playlist controls button has been clicked
     * 'playlist3:hideControls' the hide playlist controls button has been clicked
     */
    var Playlist3 = function(options) {
        debug.log('Playlist3: ', options);

        // default options
        this.defaults = {
            duration: 10,  // 10 seconds
            singlePageDuration: 86400, // 1 day
            players: [1, 2],
            controls: false,
            controlsTimeout: 120, // 2 minutes
            videowall: false
        };

        // events
        this.events = {
            SHOWVIDEO: 'playlist3:showvideo',
            SHOWPAGE: 'playlist3:showpage',
            SHOWSLIDE: 'playlist3:showslide',
            ONPLAY: 'playlist3:play',
            ONPAUSE: 'playlist3:pause',
            ONNEXT: 'playlist3:next',
            ONPREVIOUS: 'playlist3:previous',
            ONSHOWCONTROLS: 'playlist3:showControls',
            ONHIDECONTROLS: 'playlist3:hideControls'
        };

        // extend defaults with passed in options
        if (options) {
            this.defaults = $.extend({}, this.defaults, options);
        }

        if (this.defaults.videowall) {
            VideoWall3.getInstance().register(this);
        }

        // playlist3 internal variables
        this.slideIndex = 0;
        this.pageIndex = 0;
        this.toggle = '';
        this.currentSlide = null;
        this.readyPlayer = this.defaults.players[0];
        this.slideTimer = null;
        this.controlsTimer = null;
        this.slideList = [];
        this.pageList = [];

        /**
         * Load takes a jQuery list of slides (and optionally an additional list of pages)
         * resets Playlist3's internal variables, formats the passed in lists and then
         * loads them into slideList and pageList. Also calls initVideos().
         *
         * @static
         * @param {array} slides a jQuery list of slides
         * @param {array} [pages] an optional jQuery list of pages
         * @returns {undefined}
         */
        this.load = function(slides, pages) {
            slides = slides || [];
            pages = pages || [];

            this.slideIndex = 0;
            this.pageIndex = 0;
            this.currentSlide = null;
            this.readyPlayer = this.defaults.players[0];
            this.slideList = [];
            this.pageList = [];

            clearTimeout(this.slideTimer);
            this.slideTimer = null;

            if (slides.length) {
                this.slideList = this.formatList(slides);
                this.toggle = 'slide';
            }

            if (pages.length) {
                this.pageList = this.formatList(pages);
                this.toggle = 'page';
            }

            this.initVideos();

            if (this.defaults.controls) {
                this.initControls();
            }

            if (this.defaults.videowall) {
                VideoWall3.getInstance().connect();
            }
        };

        /**
         * FormatList hides the list, converts it to an array
         * then checks to see if the list is just one video and
         * if it is, duplicates the video which prevents black
         * screen issues when the list has only one video
         *
         * @private
         * @param {array} slides a jQuery list of slides
         * @returns {array} the formatted list
         */
        this.formatList = function(slides) {
            $(slides).css('visibility', 'hidden');

            var list = slides.toArray();

            // if list has only 1 slide and it's a video, duplicate it
            if (list.length === 1 && $(list[0]).hasClass('video')) {
                list.push((list[0]));
            }

            return list;
        };

        /**
         * If there are players configured, initVideos will add one
         * video tag for each. For example, new Playlist3({ players: [1, 2] });
         * will initialize a playlist that has control over video tags: video-1
         * and video-2. Any videos in the playlist will automatically use these
         * tags to show the video.
         *
         * @private
         * @returns {undefined}
         */
        this.initVideos = function() {
            var self = this;
            var players = $('#players');

            // only add #players div if there are players and it doesn't already exist
            if (this.defaults.players.length && players.length === 0) {
                players = $('<div id="players"></div>');

                $('body').append(players);
            }

            this.defaults.players.forEach(function(player, index) {
                var src = '';
                var video = $('#video-' + player);

                // only add video tag if it doesn't already exist
                if (video.length === 0) {
                    // texture tag is necessary to prevent black screen when switching pages
                    video = $('<video texture muted id="video-' + player + '" style="visibility: hidden;"></video>');

                    players.append(video);

                    // only bind the ended event once when video tag is created
                    var videoElement = document.getElementById('video-' + player);

                    videoElement.addEventListener('ended', function(e) {
                        self.slideEnded(e.currentTarget);
                    });
                }

                // look at first slide in the list to see if it's a video
                if ($(self.slideList[0]).hasClass('video')) {
                    src = $(self.slideList[0]).data('src');
                }

                // only set first video tags src if it isn't already set
                if (!index && src && !video.attr('src')) {
                    video.attr('src', src);

                    var videoToLoad = document.getElementById('video-' + player);

                    videoToLoad.load();
                }
            });
        };

        /**
         * Builds the html and creates/binds on click events for playlist controls
         * (play/pause, previous and next) for use on touch screens.
         *
         * @private
         * @returns {undefined}
         */
        this.initControls = function() {
            var self = this;
            // remove existing controls
            $('.playlist-controls').remove();

            /**
             * Starts a timer that will resume the playlist and hide the controls.
             */
            function controlsTimer() {
                if (self.controlsTimer) {
                    clearTimeout(self.controlsTimer);
                    self.controlsTimer = null;
                }

                if (self.defaults.controlsTimeout) {
                    self.controlsTimer = setTimeout(function() {
                        var paused = !$('.playpause').hasClass('pause');

                        if (paused) {
                            onPlayOrPause();
                        }

                        onHideControls();
                    }, self.defaults.controlsTimeout * 1000);
                }
            }

            /**
             * Handler for show controls up arrow button clicks, slides controls into view
             */
            function onShowControls() {
                $('.controls-popout').addClass('slideup');

                controlsTimer();

                $(document).trigger(self.events.ONSHOWCONTROLS);
            }

            /**
             * Handler for hide controls 'X' button clicks, slides controls out of view
             */
            function onHideControls() {
                $('.controls-popout').removeClass('slideup');

                controlsTimer();

                $(document).trigger(self.events.ONHIDECONTROLS);
            }

            /**
             * Handler for controls previous button clicks, decrement index three times, once to rewind
             * from preloading the next slide, once to go back a slide, and again to counter the increment
             * index in loadNextSlide.  Then calls slideEnded to end the current slide (which starts the
             * next, or in this case, previous slide).
             */
            function onPrevious() {
                var paused = !$('.playpause').hasClass('pause');

                self.decrementIndex();
                self.decrementIndex();
                self.decrementIndex();
                self.loadNextSlide();
                self.slideEnded();

                if (paused) {
                    self.stop();
                }

                controlsTimer();

                $(document).trigger(self.events.ONPREVIOUS);
            }

            /**
             * Handler for controls next button clicks, calls slideEnded which stops the current slide
             * and starts the next slide.
             */
            function onNext() {
                var paused = !$('.playpause').hasClass('pause');

                self.decrementIndex();
                self.loadNextSlide();
                self.slideEnded();

                if (paused) {
                    self.stop();
                }

                controlsTimer();

                $(document).trigger(self.events.ONNEXT);
            }

            /**
             * Handler for controls play/pause button clicks, clicking the play button toggles
             * it to the paused state and stops the playlist.  Clicking the pause button toggles
             * it to the playing state, decrements the index (otherwise unpausing would continue
             * with the next slide) and then starts the playlist.
             */
            function onPlayOrPause() {
                var playing = $('.playpause').hasClass('pause');

                if (playing) {
                    self.stop();

                    $(document).trigger(self.events.ONPAUSE);
                }
                else {
                    if ($(self.currentSlide).hasClass('video')) {
                        // unpausing a video, toggle readyPlayer back
                        self.readyPlayer = self.readyPlayer === self.defaults.players[0] ? self.defaults.players[1] : self.defaults.players[0];
                        // get the paused video element
                        var video = document.getElementById('video-' + self.readyPlayer);
                        // toggle readyPlayer to prepare for next video
                        self.readyPlayer = self.readyPlayer === self.defaults.players[0] ? self.defaults.players[1] : self.defaults.players[0];
                        // play/unpause
                        video.play();
                    }
                    else {
                        self.decrementIndex();
                        self.decrementIndex();
                        self.loadNextSlide();
                        self.slideEnded();
                    }

                    $(document).trigger(self.events.ONPLAY);
                }

                controlsTimer();

                $('.playpause').toggleClass('pause');
            }

            // create control buttons
            var openControlsButton = $('<button name="playlist-controls-open" class="controls-open">');
            var closeControlsButton = $('<button name="playlist-controls-close" class="close">');
            var previousButton = $('<button name="playlist-controls-prev" class="prev">');
            var nextButton = $('<button name="playlist-controls-next" class="next">');
            var playpauseButton = $('<button name="playlist-controls-playpause" class="playpause pause">');

            // bind on click events
            openControlsButton.on('click', onShowControls);
            closeControlsButton.on('click', onHideControls);
            previousButton.on('click', onPrevious);
            nextButton.on('click', onNext);
            playpauseButton.on('click', onPlayOrPause);

            // make an unordered list of controls (previous, play/pause, next)
            var ul = $('<ul>');

            ul.append($('<li>').append(previousButton));
            ul.append($('<li>').append(playpauseButton));
            ul.append($('<li>').append(nextButton));

            // controls popout
            var popout = $('<div class="controls-popout">').append(closeControlsButton, ul);
            // controls wrapper
            var wrapper = $('<div class="playlist-controls">').append(openControlsButton, popout);

            // append wrapper to body
            $('body').append(wrapper);
        };

        /**
         * GetCurrentSlide looks at the value of toggle, if toggle is 'page'
         * returns the current page, if toggle is anything else (aka 'slide')
         * it returns the current slide.
         *
         * @private
         * @returns {object} the current slide
         */
        this.getCurrentSlide = function() {
            if (this.toggle === 'page') {
                return this.pageList[this.pageIndex];
            }
            else {
                return this.slideList[this.slideIndex];
            }
        };

        /**
         * Starts the playlist. Should only be called after loading the playlist
         * with Playlist3.load(). Starts playing the playlist. NOTE: does not
         * need to be called if the playlist is being managed by the video wall
         *
         * @static
         * @returns {undefined}
         */
        this.start = function() {
            var self = this;

            this.currentSlide = this.getCurrentSlide();

            if (this.currentSlide) {
                stopAppTimer(true);
            }

            if ($(this.currentSlide).hasClass('video')) {
                var video = document.getElementById('video-' + this.readyPlayer);

                this.readyPlayer = this.readyPlayer === this.defaults.players[0] ? this.defaults.players[1] : this.defaults.players[0];

                video.play();

                $(video).css('visibility', 'visible');

                // instance specific
                debug.log('Playlist3 start triggered: ', this.events.SHOWVIDEO, this.slideIndex);
                $(this).trigger(this.events.SHOWVIDEO, this.slideIndex);
            }
            else {
                $(this.currentSlide).css('visibility', 'visible');

                var timeout = ($(this.currentSlide).data('duration') || this.defaults.duration) * 1000;

                this.slideTimer = setTimeout(function() {
                    self.slideEnded();
                }, timeout);

                if ($(this.currentSlide).hasClass('page')) {
                    debug.log('Playlist3 start triggered: ', this.events.SHOWPAGE, this.pageIndex);
                    $(document).trigger(this.events.SHOWPAGE, this.pageIndex);
                }
                else {
                    debug.log('Playlist3 start triggered: ', this.events.SHOWSLIDE, this.slideIndex);
                    $(document).trigger(this.events.SHOWSLIDE, this.slideIndex);
                }
            }

            this.loadNextSlide();
        };

        /**
         * Called when a slide is done showing or playing
         * sets slideToHide and checks if playlist is running as
         * a videowall. If it is, gets the video wall instance and
         * calls slideEnded, if it is not, calls showNextSlide
         *
         * @param {*} slideToHide
         */
        this.slideEnded = function(slideToHide) {
            slideToHide = slideToHide || this.currentSlide;

            if (this.defaults.videowall) {
                VideoWall3.getInstance().slideEnded(this, slideToHide);
            }
            else {
                this.showNextSlide(slideToHide);
            }
        };

        /**
         * Hides the slide that just ended playing.  Clears the slideTimer and then
         * calls start() which shows the next slide in the list.
         *
         * @param {object} slideToHide the current playing slide that will be hidden
         * @returns {undefined}
         */
        this.showNextSlide = function(slideToHide) {
            // hide all video players
            this.defaults.players.forEach(function(player) {
                $('#video-' + player).css('visibility', 'hidden');
            });
            // hide all slides
            $(this.slideList).css('visibility', 'hidden');
            // hide all pages
            $(this.pageList).css('visibility', 'hidden');
            // could be a page with screens so hide those as well
            $(slideToHide).find('.screen').css('visibility', 'hidden');
            // hide pages inner slideshow
            $(slideToHide).find('.innerslideshow .slide').css('visibility', 'hidden');

            clearTimeout(this.slideTimer);
            this.slideTimer = null;

            this.start();
        };

        /**
         * LoadNextSlide increments the list index, gets the slide that will show next
         * and checks to see if it's a video. If it is, it loads it in the 'readyPlayer'
         *
         * @private
         * @returns {undefined}
         */
        this.loadNextSlide = function() {
            this.incrementIndex();

            var nextSlide = this.slideList[this.slideIndex];

            if ($(nextSlide).hasClass('video')) {
                var player = document.getElementById('video-' + this.readyPlayer);

                player.src = $(nextSlide).data('src');
                player.load();
            }
        };

        /**
         * IncrementIndex uses 'toggle' to decide which index to increment, resets indexes to
         * zero if the list has ended and calls toggleSwap.
         *
         * @private
         * @returns {undefined}
         */
        this.incrementIndex = function() {
            if (this.toggle === 'slide') {
                this.slideIndex++;

                if (this.slideIndex >= this.slideList.length) {
                    this.slideIndex = 0;
                }
            }
            else {
                this.pageIndex++;

                if (this.pageIndex >= this.pageList.length) {
                    this.pageIndex = 0;
                }
            }

            this.toggleSwap();
        };

        /**
         * DecrementIndex uses 'toggle' to decide which index to decrement, calls toggleSwap
         * then resets indexes to list length if the list has reached the start.
         *
         * @private
         * @returns {undefined}
         */
        this.decrementIndex = function() {
            this.toggleSwap();

            if (this.toggle === 'slide') {
                this.slideIndex--;
                if (this.slideIndex < 0) {
                    this.slideIndex = this.slideList.length - 1;
                }
            }
            else {
                this.pageIndex--;
                if (this.pageIndex < 0) {
                    this.pageIndex = this.pageList.length - 1;
                }
            }
        };

        /**
         * Toggles value only changes if there is a list of slides AND a list of pages that
         * were passed in to Playlist3.load(). If both were passed in, Playlist3 will show
         * a page first, then a slide and so on.
         *
         * @private
         * @returns {undefined}
         */
        this.toggleSwap = function() {
            // if pageToggle is set to page and there are slides, toggle it to slide
            if (this.toggle === 'page' && this.slideList.length > 0) {
                this.toggle = 'slide';
            }
            // if pageToggle is set to slide and there are pages, toggle it to page
            else if (this.toggle === 'slide' && this.pageList.length > 0) {
                this.toggle = 'page';
            }
        };

        /**
         * Loops through the players assigned to this playlist, pauses the video
         * and sets readyPlayer to the player that was paused. Also clears the
         * slideTimer and disconnects from the video wall (if videowall is in use).
         *
         * @static
         * @returns {undefined}
         */
        this.stop = function(reset) {
            this.defaults.players.forEach(function(player) {
                var video = document.getElementById('video-' + player);

                if (video && video.src) {
                    video.pause();
                }

                if (video && reset) {
                    video.src = '';
                }
            });

            if (reset) {
                this.slideIndex = 0;
                this.pageIndex = 0;
                this.currentSlide = null;
                this.readyPlayer = this.defaults.players[0];

                this.slideList = [];
                this.pageList = [];
            }

            clearTimeout(this.slideTimer);
            this.slideTimer = null;

            if (this.defaults.videowall) {
                VideoWall3.getInstance().disconnect();
            }
        };

        return this;
    };

    /**
     * Singleton videowall object
     *
     * FIXME: comment this
     */
    var VideoWall3 = (function () {
        debug.log('VideoWall3');

        var instance = null;
        var playlist = null;
        var slide = null;
        var isMaster = true;
        var runningLocal = false;
        var serviceStarted = false;
        var connection = null;
        var masterIP = '';
        var myIP = '';
        var isMasterSet = false;

        /**
         * Register a playlist3 instance with the videowall instance.
         * Sets masterIP and then gets its own IP
         * Ex: VideoWall3.getInstance().register(this);
         *
         * @param {object} that a playlist3 instance
         */
        function register(that) {
            if (typeof webOS === 'undefined') {
                runningLocal = true;
            }

            playlist = that;

            masterIP = getMasterIP();

            PLATFORM.getIP(setScreenRole);
        }

        /**
         * PLATFORM.getIP callback function, sets myIP and isMaster then
         * starts the service
         *
         * @param {string} ip the ip address returned by PLATFORM.getIP
         */
        function setScreenRole(ip) {
            myIP = ip;

            var params = getAllUrlParams(window.location.href);

            if (params && params.slave) {
                isMaster = false;
            }
            else {
                if (myIP === masterIP) {
                    isMaster = true;
                }
                else {
                    isMaster = false;
                }
            }
        }

        /**
         * Looks up vwinfo in localStorage and returns the masterip if
         * there is one, otherwise returns MASTER_IP (for example,
         * when running locally).
         */
        function getMasterIP() {
            var vwinfo = jsonParse(localStorage.getItem('vwinfo'));

            if (vwinfo && vwinfo.masterip && vwinfo.masterip !== 'n/a') {
                return vwinfo.masterip;
            }

            return MASTER_IP;
        }

        /**
         * Starts the node.js sync service on webOS screens
         */
        function connect() {
            debug.log('VideoWall3 connect');
            serviceStarted = false;

            var success = function() {
                serviceStarted = true;

                debug.log('VideoWall3 connect success');

                wsConnect();
            };

            if (runningLocal) {
                success();
            }
            else {
                debug.log('VideoWall3 starting sync service');
                webOS.service.request(WEBOS_SERVICE, {
                    method: 'connect',
                    onSuccess: function() {
                        success();
                    },
                    onFailure: function(err) {
                        console.log(JSON.stringify(err));
                        debug.log('VideoWall3 connect failure', err);
                    },
                    subscribe: true
                });
            }

            // retry timeout in case webOS service request fails
            setTimeout(function() {
                if (serviceStarted === false) {
                    connect();
                }
            }, SERVICE_TIMEOUT * 1000);
        }

        /**
         * Uses web sockets to connect to the node.js sync service.
         * Also sets up onmessage handler.
         */
        function wsConnect() {
            debug.log('VideoWall3 wsConnect');
            window.WebSocket = window.WebSocket || window.MozWebSocket;
            var url = 'ws://' + masterIP + ':' + PORT_NUM;

            if (connection) {
                return;
            }

            connection = new WebSocket(url);

            connection.onopen = function() {
                debug.log('VideoWall3 wsConnect onopen');
                if (isMaster === true) {
                    wsSend('registerMaster', {
                        ip: myIP,
                        listSize: playlist.slideList.length
                    });
                }
                else {
                    wsSend('registerSlave', {
                        ip: myIP
                    });
                }

                var track = 0;

                if (playlist.toggle === 'page') {
                    track = playlist.pageIndex;
                }
                else {
                    track = playlist.slideIndex;
                }

                wsSend('ready', {
                    track: track
                });
            };

            connection.onmessage = function(msg) {
                debug.log('VideoWall3 wsConnect onmessage', msg);
                var msgObject = jsonParse(msg.data);

                if (msgObject.type === 'load') {
                    playlist.pageIndex = msgObject.data.track;
                    playlist.slideIndex = msgObject.data.track;

                    wsSend('ready', {
                        track: playlist.slideIndex
                    });
                }
                else if (msgObject.type === 'play') {
                    var track = 0;

                    if (playlist.toggle === 'page') {
                        track = playlist.pageIndex;
                    }
                    else {
                        track = playlist.slideIndex;
                    }

                    nextSlide();

                    if (isMaster === true) {
                        wsSend('masterPlayed', {
                            track: track
                        });
                    }
                }
                else if (msgObject.type === 'setMaster') {
                    if (!isMasterSet || (msgObject.data && msgObject.data.reset)) {
                        setMaster();
                    }
                }
                else if (msgObject.type === 'setSlave') {
                    setSlave(msgObject.data.basetime, msgObject.data.port);
                }
            };

            connection.onerror = function() {
                debug.log('VideoWall3 wsConnect onerror');
                if (connection && connection.readyState === WebSocket.OPEN) {
                    connection.close();
                }
                else {
                    connect();
                }
            };

            connection.onclose = function() {
                debug.log('VideoWall3 wsConnect onclose');
                connection = null;

                setTimeout(function() {
                    if (serviceStarted) {
                        wsConnect();
                    }
                    else {
                        connect();
                    }
                }, WAITING_MASTER_DURATION);
            };
        }

        /**
         * Function used to send commands/data to the node.js sync service
         *
         * @param {string} type the command type (ready, setMaster, setSlave etc)
         * @param {object} data the data sent with the command
         */
        function wsSend(type, data) {
            debug.log('VideoWall3 wsSend:', type, data);
            if (connection && connection.readyState === WebSocket.OPEN) {
                var msg = {
                    type: type,
                    data: data
                };

                connection.send(JSON.stringify(msg));
            }
            else {
                setTimeout(function() {
                    wsSend(type, data);
                }, 100);
            }
        }

        /**
         * Uses custom.VideoSync.setMaster to get the basetime to send with the setSlave command
         */
        function setMaster() {
            debug.log('VideoWall3 setMaster');
            isMasterSet = true;
            var setMasterCnt = 0;
            var port = playlist.readyPlayer === 1 ? VID_PORT_1 : VID_PORT_2;
            var player = document.getElementById('video-' + playlist.readyPlayer);
            var mediaId = 0;

            if (player && player.src && player.src.mediaId) {
                mediaId = player.src.mediaId;
            }

            var options = {
                ip: masterIP,
                port: port,
                mediaId: mediaId
            };

            var success = function(cbObject) {
                setMasterCnt = 0;
                var basetime = 0;

                if (cbObject && cbObject.basetime) {
                    basetime = cbObject.basetime;
                }

                wsSend('setSlave', {
                    basetime: basetime,
                    port: port
                });
            };

            var failure = function() {
                if (setMasterCnt++ < 20) {
                    setTimeout(setMaster, 500);
                }
                else {
                    setMasterCnt = 0;
                }
            };

            var mediaCnt = 0;
            var checkMediaID = function() {
                if (player.src & mediaCnt < 30) {
                    mediaCnt++;
                    setTimeout(checkMediaID, 300);
                }
                else {
                    var custom = new Custom();

                    custom.VideoSync.setMaster(success, failure, options);
                }
            };

            if (!runningLocal) {
                if (mediaId) {
                    checkMediaID();
                }
                else {
                    success();
                }
            }
            else {
                success();
            }
        }

        /**
         * Uses custom.VideoSync.setSlave to set the basetime
         */
        function setSlave(basetime, port) {
            debug.log('VideoWall3 setSlave');
            var setSlaveCnt = 0;
            var player = document.getElementById('video-' + playlist.readyPlayer);

            var options = {
                ip: masterIP,
                port: port,
                basetime: basetime
            };

            var success = function() {
                setSlaveCnt = 0;
                wsSend('runMaster');
            };

            var failure = function() {
                if (setSlaveCnt++ < 20) {
                    setTimeout(function() {
                        setSlave(basetime, port);
                    }, 500);
                }
                else {
                    setSlaveCnt = 0;
                    wsSend('runMaster');
                }
            };

            if (runningLocal) {
                success();
            }
            else {
                if (player.src.mediaId) {
                    var custom = new Custom();

                    custom.VideoSync.setSlave(success, failure, options);
                }
                else {
                    success();
                }
            }
        }

        /**
         * This is where we're messaging everybody, including self, if this is the master screen.
         * If this is a slave screen, this function does nothing.
         *
         * Maybe the slaves should save the reference to 'that'?
         *
         * The message receiver calls the playlist.
         *
         * @param {*} that
         * @param {*} slideToHide
         */
        function slideEnded(that, slideToHide) {
            debug.log('VideoWall3 slideEnded:', $(slideToHide).attr('name'));
            if (playlist !== that) {
                return;
            }

            isMasterSet = false;

            slide = slideToHide;

            var track = 0;

            if (playlist.toggle === 'page') {
                track = playlist.pageIndex;
            }
            else {
                track = playlist.slideIndex;
            }

            // message ready
            wsSend('ready', {
                track: track
            });
        }

        /**
         * Call showNextSlide on the registered playlist object.  The slideToHide
         * received in slideEnded is passed to the playlist.
         */
        function nextSlide() {
            debug.log('VideoWall3 nextSlide:', $(slide).attr('name'));
            playlist.showNextSlide(slide);
        }

        function disconnect() {
            debug.log('VideoWall3 disconnect');
            if (connection) {
                connection.onclose = function() {
                    connection = null;
                };
                connection.close();
            }

            isMasterSet = false;
        }

        function createInstance() {
            return {
                connect: connect,
                disconnect: disconnect,
                register: register,
                slideEnded: slideEnded
            };
        }

        return {
            getInstance: function () {
                if (!instance) {
                    instance = createInstance();
                }

                return instance;
            }
        };
    })();

    /**
     * @function NextGenApp
     * @description initializes a next gen app which uses Daypart3 and Playlist3 and
     * is capable of displaying menu pages, inner slideshows on the menu pages and slides.
     * If both pages and slides are being used by the app, page 1 displays first, then
     * slide 1, then page 2, then slide 2 etc. The inner slideshow alternates between panning
     * and zooming effects if the inner slide show consists of images.
     *
     * Example:
     *      ABNET.NextGenApp.init(options);
     *
     * Options:
     *      animateInnerSlideShow: if true, Playlist3 will add pan/zoom animation classes to the slides, defaults to false
     *      itemPriceOnly: if true, NextGenApp will render item prices only (not item name or calories)
     *      playlistControls: if true, Playlist3 will add controls (prev/play/pause/next) to the main playlist, defaults to false
     *      usePriceGroups: if true, NextGenApp will render a pricegroup which is the item price plus text (the text is whatever
     *      is contained between () in the item name). Defaults to false.
     *      videowall: if true, the main playlist3 will initialize as a Video Wall
     *
     * EVENTS:
     *      'nextgenapp:rendered': triggered once NextGenApp has finished rendering the app, can be
     *                             used by script.js to customize the look of the app afterwards
     *
     * Rendered Html Example for 1 Daypart:
     *     	<div id="daypart-51" class="dayparts" data-daypart="00:00" data-playfrom="00:00" data-playto="24:00" data-playwhen="1" data-playon="" style="">
     *          <div name="page-home.jpg" class="page page-51" data-duration="10" style="visibility: hidden;">
     *              <div class="screen screen1" style="background-image: url("../../../uploads/1/page-home.jpg"); visibility: visible;">
     *                  <div class="section">
     *                      <div class="text"></div>
     *                          <div class="items items1">
     *                              <div class="item">
     *                                  <span class="name">1 Taco</span>
     *                                  <span class="price">$1<span class="cents">00</span></span>
     *                                  <span class="calories">(100 cal)</span>
     *                              </div>
     *                          </div>
     *                      </div>
     *                  <div class="innerslideshow"></div>
     *              </div>
     *          </div>
     *      </div>
     */
    var NextGenApp = (function() {
        // default options
        var defaults = {
            animateInnerSlideShow: false,
            itemPriceOnly: false,
            playlistControls: false,
            controlsTimeout: 120, // 2 minutes
            usePriceGroups: false,
            videowall: false
        };

        var FIELDTYPES = {
            LABEL_CHECKBOX: '1',
            LABEL_INPUT: '2',
            LABEL_SELECT: '3',
            SELECT_INPUT: '4',
            SELECT_OPTION: '5'
        };
        // object to store slide objects keyed by filename
        var INNERSLIDES = {};
        var SLIDESHOW = [];
        var EFFECTS = ['pan', 'zoom'];
        var EFFECTSINDEX = 0;

        var ACTIVEDAYPART = null;
        var PAGESPLAYLIST = null;
        var INNERSLIDESHOW = null;
        var PREVIEWDATA = null;

        function init(options) {
            debug.log('NextGenApp init', options);
            // extend defaults with passed in options
            if (options) {
                defaults = $.extend({}, defaults, options);
            }

            // always listen for downloads:finished and playlist3:showslide
            $(document).on('downloads:finished', downloadsFinished);
            $(document).on('playlist3:showslide', animateSlide);
            $(document).on('nextgenapp:resetplaylist', resetPlaylist);
            $(document).on('playlist3:showpage', showPage);

            var params = getAllUrlParams(window.location.href);

            if (params && params.page) {
                // app is being loaded in a preview window, clear localStorage first
                localStorage.clear();
                // video wall is always false for previews
                defaults.videowall = false;

                var displayid = params.displayid || 0;
                var uniqueid = params.uniqueid || 0;

                if (params && !params.preview) {
                    getPreviewData(displayid, function() {
                        updateContent();
                    });
                }
                else {
                    fakeCheckUpdates(uniqueid, function() {
                        updateContent();
                    });
                }

                window.addEventListener('message', function(data) {
                    if (data && data.data && data.data.data) {
                        PREVIEWDATA = data.data.data;
                        renderApp();
                    }
                    else {
                        PREVIEWDATA = null;
                    }
                }, false);
            }
            else {
                startAppTimer();
                // only listen for these events when the app is running as an app
                $(document).on('platform:identity', checkUpdates);
                $(document).on('content:changed', updateContent);
                $(document).on('daypart:showslide', setActiveDaypart);

                // WebOS starts the check identity timer in platform.js
                if (PLATFORM.NAME !== 'WEBOS') {
                    setInterval(PLATFORM.checkIdentity, ABNET.IDENTITY_CHECK_INTERVAL);
                    PLATFORM.checkIdentity();
                }

                updateContent();
            }
        }

        function updateContent() {
            var justVersion = localStorage.getItem('justversion');

            if (justVersion === 'false' && defaults.videowall) {
                debug.log('NextGenApp updateContent PLATFORM.reboot()');
                PLATFORM.reboot();
            }

            if (INNERSLIDESHOW) {
                INNERSLIDESHOW.stop();
            }

            if (PAGESPLAYLIST) {
                PAGESPLAYLIST.stop(true);
            }

            // update playlists in localStorage and get files to download
            var filesToAction = ABNET.PlatformUtils.getFilesToAction();
            var files = ABNET.PlatformUtils.getFilesToDownload(filesToAction);

            debug.log('NextGenApp updateContent PLATFORM.downloadFiles:', files);

            PLATFORM.downloadFiles(files);
        }

        function downloadsFinished() {
            debug.log('NextGenApp downloadsFinished');
            initPlaylists();

            getItems(function() {
                renderApp();
            });
        }

        function initPlaylists() {
            debug.log('NextGenApp initPlaylists');
            var pagesPlayers = [1, 2];
            var innerPlayers = [3, 4];

            // RPN does not support video tags, so pass in empty player arrays
            if (PLATFORM.NAME === 'RPN') {
                pagesPlayers = [];
                innerPlayers = [];
            }

            if (!PAGESPLAYLIST) {
                PAGESPLAYLIST = new Playlist3({
                    players: pagesPlayers,
                    controls: defaults.playlistControls,
                    controlsTimeout: defaults.controlsTimeout,
                    videowall: defaults.videowall
                });

                // listen for showvideo on the pages playlist
                $(PAGESPLAYLIST).on('playlist3:showvideo', showVideo);
            }

            if (!INNERSLIDESHOW) {
                INNERSLIDESHOW = new Playlist3({ players: innerPlayers });
            }
        }

        // sets ABCONST.ITEMS to the contents of /items/getitems
        function getItems(cb) {
            debug.log('NextGenApp getItems');

            var url = ABNET.SERVER_URL.replace('http://','https://') + '/items/getitems?api=3&id=' + ABCONST.APP_ID;
            var client = getClient();

            if (client === 'dce2' || client === 'dev' || client === 'qa') {
                url = ABNET.SERVER_URL + '/items/getitems?api=3&id=' + ABCONST.APP_ID;
            }

            $.ajax({
                type: 'get',
                url: url,
                cache: false,
                contentType: false,
                processData: false,
                success: function(response) {
                    ABCONST.ITEMS = JSON.parse(response[0]);
                    debug.log('NextGenApp getItems success:', ABCONST.ITEMS);
                    cb();
                },
                error: function() {
                    // set items to empty array so app doesn't break
                    ABCONST.ITEMS = [];
                    debug.log('NextGenApp getItems failure');
                    cb();
                }
            });
        }

        // rebuilds #pages-content
        function renderApp() {
            debug.log('NextGenApp renderApp');
            var params = PREVIEWDATA || getAllUrlParams(window.location.href);

            var dayparts = jsonParse(localStorage.getItem('dayparts'));
            var content = jsonParse(localStorage.getItem('content'));

            if (!isPreviewMode()) {
                startAppTimer();
            }

            // get screen count
            var screens = ABNET.PlatformUtils.getScreenCount();
            // get screen number
            var screen = ABNET.PlatformUtils.getScreenIndex();

            var downloadedKey = 'downloaded';

            if (screens > 1) {
                downloadedKey += '-' + screen;
            }

            var playlists = jsonParse(localStorage.getItem(downloadedKey));

            if (isPreviewMode()) {
                dayparts = DOWNLOADED[screen].dayparts;
                playlists = DOWNLOADED[screen].playlists;
            }

            if (params && params.content) {
                content = JSON.parse(params.content);
            }

            if (!dayparts) {
                return;
            }

            // reset #pages-content div
            var contentPages = $('#pages-content').empty();

            if (contentPages.length === 0) {
                contentPages = $('<div id="pages-content">');

                $('body').append(contentPages);
            }

            // loop through dayparts
            dayparts.forEach(function(daypart) {
                var daypartHtml = $(renderDaypart(daypart));

                // append a .dayparts for each daypart
                contentPages.append(daypartHtml);

                if (!playlists || !isArray(playlists[daypart.id])) {
                    return;
                }

                var page = 0;
                // get an array of name/path objects for each page in the playlist
                var pages = getPages(playlists[daypart.id]);

                // set INNERSLIDES
                setInnerSlides(playlists[daypart.id]);

                // loop through the daypart's playlist
                playlists[daypart.id].forEach(function(slide) {
                    if (slide.type === 'page') {
                        page += 1; // increment page

                        var pageHtml = $('<div name="' + slide.name + '" class="page page-' + daypart.id + '" data-duration="' + slide.duration + '"></div>');

                        // append a .page for each slide of type page
                        daypartHtml.append(pageHtml);

                        // get the file for this page by index
                        var file = pages[page];
                        var uri = encode(file.path);
                        var css = 'background-image: url(' + uri + ')';
                        var screenHtml = $('<div class="screen screen' + screen + '" style="' + css + '"></div>');
                        var items = $('<div class="items"></div>');
                        var styles = null;

                        if (ABCONST.PAGECLASSES) {
                            // get styles for this file from ABCONST
                            styles = ABCONST.PAGECLASSES[file.name.toLowerCase()];
                        }

                        // append a .screen for each screen
                        pageHtml.append(screenHtml);

                        if (!styles) {
                            // no styles to apply, append items to screen
                            screenHtml.append(items);
                        }
                        else {
                            // array of styles, change items into an array
                            if (isArray(styles)) {
                                items = [];

                                // loop through styles, pushing a jQuery object and size limit for each item to items
                                styles.forEach(function(style) {
                                    var item = $('<div class="items ' + style.name + '"></div>');

                                    items.push({
                                        item: item,
                                        size: style.size
                                    });

                                    var div = $('<div class="section"></div>');

                                    // append a static text div
                                    div.append('<div class="text"></div>');
                                    // append a .items for each style
                                    div.append(item);
                                    // append the div to the screen
                                    screenHtml.append(div);
                                });
                            }
                            // one style
                            else {
                                var div = $('<div class="section"></div>');

                                // append a static text div
                                div.append('<div class="text"></div>');

                                items = $('<div class="items ' + styles + '"></div>');
                                // append a .items for the one style
                                div.append(items);
                                // append the div to the screen
                                screenHtml.append(div);
                            }
                        }

                        // get this page/screens category
                        var category = getScreenCategory(slide.name, screen);
                        // render no selects with matching category
                        var noSelects = renderNoSelects(category);
                        // append no selects to the screens items
                        screenHtml.find('.items').append(noSelects);

                        var innerSlideshow = $('<div class="innerslideshow"></div>');

                        // append an inner slideshow for each screen
                        screenHtml.append(innerSlideshow);

                        if (content && content[daypart.id] && content[daypart.id][page] && content[daypart.id][page][screen]) {
                            var idx = 0;

                            // TA Kitchen (app 58) items are handled differently from all other apps
                            // to keep items in the correct order, we must loop through the values
                            // assigned to the daypart/page/screen and then look up each item rather
                            // than looping through all the items in the order they come (like other apps)
                            if (ABCONST.APP_ID === 58) {
                                content[daypart.id][page][screen].forEach(function(id, itemIndex) {
                                    var item = getItemById(id);

                                    if (item && item.Category.toLowerCase() === category) {
                                        if (item.Type && item.Type === FIELDTYPES.SELECT_OPTION) {
                                            // skip rendering select option items
                                            return;
                                        }

                                        var renderedItem = renderItem(item, itemIndex);

                                        appendItem(items, item, renderedItem, innerSlideshow);

                                        idx += 1;
                                    }
                                    else if (isNaN(parseInt(id))) {
                                        screenHtml.prepend('<div class="title">' + id + '</div>');
                                    }
                                });
                            }
                            else {
                                ABCONST.ITEMS.forEach(function(item, itemIndex) {
                                    if (item.Category.toLowerCase() === category) {
                                        if (item.Type && item.Type === FIELDTYPES.SELECT_OPTION) {
                                            // skip rendering select option items
                                            return;
                                        }

                                        if (item.Type) {
                                            item.Price1 = content[daypart.id][page][screen][idx];
                                        }

                                        // if field type is select input, the current value (of the select) becomes the item name
                                        // and next value (of the input) becomes the price
                                        if (item.Type === FIELDTYPES.SELECT_INPUT) {
                                            // get item by name
                                            item = getItemByName(content[daypart.id][page][screen][idx]);
                                            idx += 1;
                                            item.Price1 = content[daypart.id][page][screen][idx];
                                        }

                                        var renderedItem = renderItem(item, itemIndex);

                                        appendItem(items, item, renderedItem, innerSlideshow);

                                        idx += 1;
                                    }
                                });
                            }

                            // if innerSlideshow is empty, populate with INNERSLIDES
                            if (!innerSlideshow.find('.slide').length) {
                                for (var prop in INNERSLIDES) {
                                    if (Object.prototype.hasOwnProperty.call(INNERSLIDES, prop)) {
                                        innerSlideshow.append(renderInnerSlide(INNERSLIDES[prop]));
                                    }
                                }
                            }
                        }
                    }
                    else if (slide.type === 'file') {
                        // render a regular slide
                        daypartHtml.append(renderSlide(slide, 'outterslide slide-' + daypart.id));
                    }
                });
            });

            // hide pages and screens
            $('.page').css('visibility', 'hidden');
            $('.screen').css('visibility', 'hidden');

            // let the app know rendering has finished
            debug.log('NextGenApp renderApp triggered nextgenapp:rendered');
            $(document).trigger('nextgenapp:rendered');

            // only initialize Daypart3 if running as an app
            if (params && !params.page || params && params.slave) {
                Daypart3($('.dayparts'), defaults.videowall);
            }

            if (params && params.slideshow && params.daypart) {
                // set ACTIVEDAYPART
                ACTIVEDAYPART = 'daypart-' + params.daypart;

                var daypart = $('#' + ACTIVEDAYPART);

                daypart.show();

                // get slides and pages from daypart
                var slides = $('#daypart-' + params.daypart).find('.outterslide');
                var pages = $('#daypart-' + params.daypart).find('.page');

                if (ABCONST.APP_ID === SHEETZ_KIOSK) {
                    slides = $('#daypart-' + params.daypart).find('.outterslide').not('.video');
                }

                if (PAGESPLAYLIST) {
                    PAGESPLAYLIST.stop();
                    PAGESPLAYLIST.load(slides, pages);
                    PAGESPLAYLIST.start();
                }
            }

            // for live preview from UI
            if (params.daypart && params.daypart === params.activedaypart && params.page && params.page === params.activepage) {
                // get the proper page
                var page = $('#daypart-' + params.daypart).find('.page').eq(params.page - 1);

                // set the proper screen to visible
                page.find('.screen' + params.screen).css('visibility', 'visible');

                SLIDESHOW = page.find('.screen' + params.screen).find('.slide-images');

                if (INNERSLIDESHOW && SLIDESHOW.length) {
                    // start the screen specific slideshow
                    INNERSLIDESHOW.load(SLIDESHOW);
                    INNERSLIDESHOW.start();
                }
            }
        }

        // Loops through ITEMS and returns item with matching id
        function getItemById(id) {
            var found = '';

            if (!id) {
                return found;
            }

            ABCONST.ITEMS.forEach(function(item) {
                if (item.id === id.toString()) {
                    found = item;
                }
            });

            return found;
        }

        // Loops through ITEMS and returns item with matching name
        function getItemByName(name) {
            var found = '';

            ABCONST.ITEMS.forEach(function(item) {
                if (item.Item === name) {
                    found = item;
                }
            });

            return found;
        }

        // Loops through a playlist looking for pages
        // returns an array of name/path objects for each page
        function getPages(files) {
            var pages = [''];

            files.forEach(function(file) {
                if (file.type === 'page') {
                    var extension = getFileExt(file.name);
                    var filename = '';
                    var filepath = '';
                    var categories = [];

                    filename = file.name.replace('.' + extension, '');
                    filepath = file.path + '/' + file.name;

                    filename.split('-').forEach(function(category) {
                        if (isNaN(parseInt(category))) {
                            categories.push(category);
                        }
                    });

                    pages.push({
                        name: filename,
                        path: filepath,
                        categories: categories
                    });
                }
            });

            return pages;
        }

        // builds INNERSLIDES object (keyed by filename to lowercase without extension)
        // from slides of type 'inner' in the slideshow
        function setInnerSlides(files) {
            files.forEach(function(slide) {
                var ext = getFileExt(slide.name);

                if (slide.type === 'inner') {
                    var key = slide.name.replace('.' + ext, '').toLowerCase();

                    INNERSLIDES[key] = {
                        'name': slide.name,
                        'path': slide.path,
                        'duration': slide.duration
                    };
                }
            });
        }

        // renders a div.item which includes 3 spans
        // one for the item name, one for the item price
        // and one for the item calories
        function renderItem(item, itemIndex) {
            var html = '';

            // do not render if item has no name or if item has no price and this is not app 58
            // app 58 has items that have names but no prices that need to be rendered
            if (!item.Item || !item.Price1 && ABCONST.APP_ID !== 58) {
                return html;
            }

            var itemName = item.Item || '';
            var checkbox = false;
            var priceText = '';
            var style = '';

            // if item name includes checkbox, price1 field
            // determines if the item should be displayed or not
            if (item.Type === FIELDTYPES.LABEL_CHECKBOX && item.Price1 === '0') {
                return html;
            }
            else if (item.Type === FIELDTYPES.LABEL_CHECKBOX) {
                checkbox = true;
            }

            // if item.Item ends with anything in (), remove it (unless it's a select/label)
            if (item.Type !== FIELDTYPES.SELECT_INPUT && item.Item && item.Item.lastIndexOf('(') !== -1) {
                // take what's in () as the 'priceText'
                priceText = item.Item.substring(item.Item.lastIndexOf('(') + 1, item.Item.length - 1);
                // get the item name minus anything in ()
                itemName = item.Item.substring(0, item.Item.lastIndexOf('(') - 1);
            }

            // add itemName as class (spaces and '&' replaced with '-', commas and () replaced with '')
            if (itemName) {
                style = itemName.split(' ').join('-').toLowerCase();
                style = style.split('"').join('');
                style = style.split('/').join('-');
                style = style.split('&').join('-');
                style = style.split('---').join('-'); // replacing spaces and & can cause ---
                style = style.split('.').join('');
                style = style.split('\'').join('');
                style = style.split(',').join('');
                style = style.split('(').join('');
                style = style.split(')').join('');
            }

            // css classes can't start with numbers, if style starts with number, remove it and append to end of item
            // example: an item named '2-axle-alignment' will have class 'axle-alignment-2'
            var firstChar = getNumberAtStart(style);

            if (firstChar) {
                style = style.slice(firstChar.toString().length, style.length) + '-' + firstChar;
            }

            // make sure style doesn't start with a -
            if (style.charAt(0) === '-') {
                style = style.slice(1, style.length);
            }

            if (priceText) {
                // add priceText as class (spaces replaced with -)
                var priceStyle = priceText.split(' ').join('-').toLowerCase();

                firstChar = getNumberAtStart(priceStyle);

                if (firstChar) {
                    priceStyle = priceStyle.slice(firstChar.toString().length, priceStyle.length) + '-' + firstChar;
                }

                // make sure style doesn't start with a -
                if (priceStyle.charAt(0) === '-') {
                    priceStyle = priceStyle.slice(1, priceStyle.length);
                }

                style = style + ' ' + priceStyle;
            }

            if (checkbox) {
                style += ' checkbox';
            }

            var priceTier = getPriceTier();

            if (!defaults.itemPriceOnly && itemName) {
                html += '<span class="name">' + itemName + '</span>';
            }

            if (item[priceTier] && !checkbox) {
                // check if this item has a valid price
                if (validatePrice(item[priceTier])) {
                    var price = item[priceTier].split('.');
                    var cents = '00';

                    if (price[1]) {
                        cents = price[1];

                        if (cents.length === 1) {
                            cents += 0;
                        }
                    }

                    if (defaults.usePriceGroups) {
                        html += '<div class="pricegroup">';
                        html += '<span class="pricetext">' + priceText + '</span>';
                        html += '<span class="price"><span class="dollar">$</span>' + price[0] + '<span class="cents">' + cents + '</span></span>';
                        html += '</div>';
                    }
                    else {
                        html += '<span class="price"><span class="dollar">$</span>' + price[0] + '<span class="cents">' + cents + '</span></span>';
                    }
                }
                // if not a valid price, treat as text
                else {
                    if (defaults.usePriceGroups) {
                        html += '<div class="pricegroup">';
                        html += '<span class="textonly">' + item[priceTier] + '</span>';
                        html += '</div>';
                    }
                    else {
                        html += '<span class="textonly">' + item[priceTier] + '</span>';
                    }
                }
            }

            // only add calories if item has a name and price
            if (!defaults.itemPriceOnly && item.Item && item.Price1 && item.Calories) {
                html += '<span class="calories">(' + item.Calories + ' cal)</span>';
            }
            else if (!defaults.itemPriceOnly && item.Item && item.Price1) {
                html += '<span class="calories"></span>';
            }

            return '<div class="item item' + (itemIndex + 1) + ' ' + style + '">' + html + '</div>';
        }

        function appendItem(items, item, renderedItem, innerSlideshow) {
            // if items is an array, there are 2 sections of items to append to
            if (isArray(items)) {
                // check length of array against it's size limit
                if (items[0].item[0].childElementCount === items[0].size) {
                    // first item set is full, append to second
                    items[1].item.append(renderedItem);
                }
                else {
                    items[0].item.append(renderedItem);
                }
            }
            else {
                // only 1 section of items to append to
                items.append(renderedItem);
            }

            // append slide if item has an image
            if (renderedItem && item.Image) {
                var slide = getInnerSlideByName(item.Image);

                if (slide) {
                    innerSlideshow.append(renderInnerSlide(slide));
                }
            }
        }

        function startsWithNumber(str) {
            return /^\d/.test(str);
        }

        function getNumberAtStart(str) {
            if (startsWithNumber(str)) {
                return Number(str.match(/^\d+/)[0]);
            }

            return null;
        }

        function renderInnerSlide(slide) {
            var file = slide.path + '/' + slide.name;
            var ext = getFileExt(file);
            var uri = encode(file);
            var duration = slide.duration;
            var html = '';

            if (!slide) {
                return;
            }

            switch (ext) {
                case 'mp4':
                case 'webm':
                    html += '<div data-src="' + uri + '" class="video slide slide-images" data-duration="' + duration + '"></div>';
                    break;
                case 'jpg':
                case 'jpeg':
                case 'png':
                case 'gif':
                    var effect = '';

                    if (defaults.animateInnerSlideShow) {
                        effect = EFFECTS[EFFECTSINDEX];

                        EFFECTSINDEX = EFFECTSINDEX ? 0 : 1;
                    }

                    // For RPN, override effect class with 'rpn' plus the name of the file so it can be positioned correctly by CSS
                    if (PLATFORM.NAME === 'RPN') {
                        effect = 'rpn ' + slide.name.toLowerCase().substr(0, slide.name.lastIndexOf('.')) || slide.name;
                    }

                    html += '<img src="' + uri + '" class="slide slide-images ' + effect + '" data-duration="' + duration + '">';
                    break;
                default:
                    break;
            }

            return html;
        }

        // triggered by playlist3:showslide
        function animateSlide(e, index) {
            $(SLIDESHOW).removeClass('animate');

            debug.log('NextGenApp animateSlide, index:', index);

            // need to wait a split second before applying animation
            setTimeout(function() {
                $(SLIDESHOW[index]).addClass('animate');
            }, 100);
        }

        // if the app is running as a preview, gets pricetier from url params
        // otherwise it looks up tags in localStorage and returns the first 'price' tag
        function getPriceTier() {
            var params = PREVIEWDATA || getAllUrlParams(window.location.href);

            if (params && params.pricetier) {
                return params.pricetier;
            }

            var tags = jsonParse(localStorage.getItem('tags'));
            var priceTier = 'Price1';

            if (isArray(tags)) {
                for (var i = 0; i < tags.length; i++) {
                    if (tags[i].indexOf('PRICE_') !== -1) {
                        // if there are multiple price tier tags, use the first
                        priceTier = 'Price' + tags[i].split('_').pop();
                        break;
                    }
                }
            }

            return priceTier;
        }

        function getScreenCategory(filename, screen) {
            screen = screen - 1;

            filename = filename.split('.')[0];

            var categories = filename.split('-');

            if (categories[screen]) {
                return categories[screen].toLowerCase();
            }

            return '';
        }

        function renderNoSelects(category) {
            var html = '';

            if (!ABCONST.ITEMS) {
                return html;
            }

            ABCONST.ITEMS.forEach(function(item, itemIndex) {
                if (item.Category.toLowerCase() === category && item.Item.indexOf('(noselect)') !== -1) {
                    html += renderItem(item, itemIndex);
                }
            });

            return html;
        }

        // takes a filename, loops through INNERSLIDES object looking for object where key = filename (minus extension)
        // returns the found slide object which contains name, path and duration
        function getInnerSlideByName(filename) {
            filename = filename.replace(/\.[0-9a-z]+$/i, '');

            var found = '';

            for (var slide in INNERSLIDES) {
                if (slide === filename.toLowerCase()) {
                    found = INNERSLIDES[slide];
                }
            }

            return found;
        }

        // triggered by 'daypart:showslide', receives the daypart name
        function setActiveDaypart(e, daypart) {
            debug.log('NextGenApp setActiveDaypart', daypart);

            // set active daypart to the daypart that just started
            ACTIVEDAYPART = daypart;

            resetPlaylist();
        }

        function resetPlaylist() {
            debug.log('NextGenApp resetPlaylist()');
            // get slides and pages from daypart
            var slides = $('#' + ACTIVEDAYPART).find('.outterslide');
            var pages = $('#' + ACTIVEDAYPART).find('.page');

            if (PAGESPLAYLIST) {
                PAGESPLAYLIST.stop();
                PAGESPLAYLIST.load(slides, pages);

                if (!defaults.videowall) {
                    PAGESPLAYLIST.start();
                }
            }
        }

        // triggered by 'playlist3:showpage', receives the pages index
        function showPage(e, index) {
            debug.log('NextGenApp showPage:', index);
            // hide all pages and screens
            $('.page').css('visibility', 'hidden');
            $('.screen').css('visibility', 'hidden');
            // remove animate class and hide slideshow
            $('.slide-images').removeClass('animate');
            $('.slide-images').css('visibility', 'hidden');

            // get screen number
            var screen = ABNET.PlatformUtils.getScreenIndex();

            // get the proper page
            var page = $('#' + ACTIVEDAYPART).find('.page').eq(index);

            // show the proper screen
            page.find('.screen' + screen).css('visibility', 'visible');

            // get the proper page's slides to load/play
            SLIDESHOW = $(page).find('.screen' + screen).find('.slide-images');

            if (INNERSLIDESHOW && SLIDESHOW.length) {
                INNERSLIDESHOW.stop();
                INNERSLIDESHOW.load(SLIDESHOW);
                INNERSLIDESHOW.start();
            }
        }

        // triggered by PAGESPLAYLIST playlist3:showvideo
        function showVideo() {
            debug.log('NextGenApp showVideo()');
            // stop the inner slideshow when a video starts on the pages playlist
            if (INNERSLIDESHOW) {
                INNERSLIDESHOW.stop();
            }
        }

        // loops through each page, if all sections on
        // the page are hidden, the page is removed
        function removeEmptyPages() {
            $('.page').each(function(idx, page) {
                var hasContent = false;

                $(page).find('.section').each(function(idx, section) {
                    if ($(section).find('.item').length) {
                        hasContent = true;
                    }
                });

                if (!hasContent) {
                    $(page).remove();
                }
            });
        }

        return {
            init: init,
            removeEmptyPages: removeEmptyPages
        };

    })();

    var PlatformUtils = (function() {

        function push(obj, onto) {
            var found = false;

            onto.forEach(function(file) {
                if (obj.id === file.id) {
                    found = true;
                }
            });

            if (!found) {
                onto.push(obj);
            }
        }

        function getFilesToAction() {
            var playlists = jsonParse(localStorage.getItem('playlists'));
            var lastDownload = jsonParse(localStorage.getItem('lastdownload'));
            var filesToAction = [];

            function findIn(id, obj) {
                var found = false;

                for (var i in obj) {
                    var playlist = obj[i];

                    if (playlist && playlist.length) {
                        playlist.forEach(function(slide) {
                            if (slide.id === id) {
                                found = true;
                            }
                        });
                    }
                }

                return found;
            }

            for (var i in playlists) {
                var playlist = playlists[i];

                if (playlist && playlist.length) {
                    playlist.forEach(function(slide) {
                        if (!findIn(slide.id, lastDownload)) {
                            slide.action = 'download';
                            push(slide, filesToAction);
                        }
                    });
                }
            }

            for (var ii in lastDownload) {
                var last = lastDownload[ii];

                if (last && last.length) {
                    last.forEach(function(slide) {
                        if (!findIn(slide.id, playlists)) {
                            slide.action = 'delete';
                            push(slide, filesToAction);
                        }
                    });
                }
            }

            for (var iii in lastDownload) {
                var list = playlists[iii];

                if (list && list.length) {
                    list.forEach(function(slide) {
                        if (findIn(slide.id, lastDownload)) {
                            slide.action = 'verify';
                            push(slide, filesToAction);
                        }
                    });
                }
            }

            return filesToAction;
        }

        function getFilesToDownload(filesToAction) {
            var playlists = jsonParse(localStorage.getItem('playlists'));
            var screenCount = getScreenCount();
            var screenIndex = getScreenIndex();
            var files = [];

            if (playlists) {
                playlists['temp'] = filesToAction;
            }

            // loop through daypart playlists
            for (var i in playlists) {
                var playlist = playlists[i];
                var listName = i;

                if (playlist && playlist.length) {
                    // loop through each slide of the playlist
                    playlist.forEach(function(slide, idx) {
                        var filename = '';
                        var filepath = '';

                        // if screen count is greater than 1, it's a videowall so we need to
                        // download the files from the .parts directory unless they're inner slides
                        if (screenCount > 1 && slide.type !== 'inner') {
                            var ext = getFileExt(slide.name);

                            filename = slide.name.replace('.' + ext, '') + '-' + screenIndex + '.' + ext;
                            filepath = slide.path + '/.parts';
                        }
                        else {
                            filename = slide.name;
                            filepath = slide.path;
                        }

                        // update original playlist object name and path
                        if (listName !== 'temp') {
                            playlist[idx].name = filename;
                            playlist[idx].path = PLATFORM.STORE + filepath;
                        }

                        var action = 'exists';
                        // look for slide in filesToAction
                        for (var i = 0; i < filesToAction.length; i++) {
                            var actionFile = filesToAction[i];

                            if (actionFile.id === slide.id) {
                                action = actionFile.action;
                            }
                        }

                        var file = filepath + '/' + filename;

                        push({
                            action: action,
                            file: file,
                            id: slide.id
                        }, files);
                    });
                }
            }

            var downloadedKey = 'downloaded';

            if (screenCount > 1) {
                downloadedKey += '-' + screenIndex;
            }

            // write the updated playlists to local storage
            localStorage.setItem(downloadedKey, JSON.stringify(playlists));

            if (isPreviewMode()) {
                DOWNLOADED[screenIndex] = {};
                DOWNLOADED[screenIndex].dayparts = jsonParse(localStorage.getItem('dayparts'));
                DOWNLOADED[screenIndex].playlists = playlists;
            }

            // currently only the sheetz kiosk appends video preview gifs for download
            if (ABCONST.APP_ID === SHEETZ_KIOSK) {
                files = files.concat(getGifsToDownload(filesToAction));
            }

            return files;
        }

        function getGifsToDownload(filesToAction) {
            var gifs = [];

            filesToAction.forEach(function(slide) {
                var filename = slide.name;
                var filepath = slide.path;
                var ext = filename.split('.').pop();

                if (ext === 'mp4') {
                    // push animated gif on to list of files to download
                    var gif = filepath + '/.sprites/' + filename.replace('mp4', 'gif');

                    push({
                        action: slide.action,
                        file: gif,
                        id: slide.id
                    }, gifs);
                }
            });

            return gifs;
        }

        function getScreenCount() {
            // if app is running as a preview, params.screen will be set
            var params = getAllUrlParams(window.location.href);

            if (params && params.screens) {
                return parseInt(params.screens);
            }

            // otherwise app is running on device, get screen index from localStorage
            var vwinfo = jsonParse(localStorage.getItem('vwinfo'));

            if (vwinfo && vwinfo.screens) {
                return parseInt(vwinfo.screens);
            }

            return 1;
        }

        function getScreenIndex() {
            // if app is running as a preview, params.screen will be set
            var params = getAllUrlParams(window.location.href);

            if (params && params.screen) {
                return parseInt(params.screen);
            }

            // otherwise app is running on device, get screen index from localStorage
            var vwinfo = jsonParse(localStorage.getItem('vwinfo'));

            if (vwinfo && vwinfo.index) {
                return parseInt(vwinfo.index);
            }

            return 1;
        }

        function loadCSS(src, cb) {
            var head = document.getElementsByTagName('head')[0];
            var script = document.createElement('link');

            script.href = src;
            script.rel = 'stylesheet';
            script.type = 'text/css';

            head.appendChild(script);

            if (cb && typeof cb === 'function') {
                script.onload = cb;
            }
        }

        function loadJS(src, cb) {
            var head = document.getElementsByTagName('head')[0];
            var script = document.createElement('script');

            script.src = src;
            script.async = true;

            head.appendChild(script);

            if (cb && typeof cb === 'function') {
                script.onload = cb;
            }
        }

        return {
            getFilesToAction: getFilesToAction,
            getFilesToDownload: getFilesToDownload,
            getScreenCount: getScreenCount,
            getScreenIndex: getScreenIndex,
            loadCSS: loadCSS,
            loadJS: loadJS
        };
    })();

    /**
     * @function Tracker
     * @description used to track page views and button clicks, saves records
     * temporarily in local storage and sends them in batches to the server
     */
    function Tracker(options) {

        var defaults = {
            appid: ABCONST.APP_ID,
            localStorageKey: 'trackingRecords',
            trackingEndPoint: ABNET.SERVER_URL + '/ajax/activity',
            batchTimer: 1 * 60 * 60 * 1000, // 1 hour (h*m*s*ms) production
            retryTimeout: 10 * 1000 // 10 seconds (s*ms)
        };

        /**
         * NOTE
         * Add a "var QUERY_INTERVAL = 10;" line to back/server.js to change the query interval
         * to 10 seconds.  We're doing this on development servers: local,
         * dev.cms and qa.cms, and also on demo.cms.
         */
        if (typeof QUERY_INTERVAL !== 'undefined') {
            defaults.batchTimer = QUERY_INTERVAL * 1000;
        }

        var events = {
            click: 'button click',
            view: 'page view'
        };

        var types = {
            click: {
                control: 'control',
                feedback: 'feedback',
                vote: 'vote'
            },
            view: {
                page: 'page',
                slide: 'slide',
                video: 'video'
            }
        };

        init(options);

        function init(options) {
            options = options || {};
            defaults = $.extend({}, defaults, options);

            startBatchTimer();
        }

        function trackClick(type, data) {
            data = data || {};

            if (type === types.click.vote) {
                data.video = getVideo();
            }

            var record = makeRecord({
                event: events.click,
                type: type,
                data: data
            });

            addRecord(record);
        }

        function trackPageView(type, data) {
            data = data || {};

            if ($.isEmptyObject(data) && type === types.view.page) {
                data = getPage();
            }
            else if ($.isEmptyObject(data) && type === types.view.video) {
                data = getVideo();
            }

            var record = makeRecord({
                event: events.view,
                type: type,
                data: data
            });

            addRecord(record);
        }

        function startBatchTimer() {
            setTimeout(sendBatch, defaults.batchTimer);
        }

        function sendBatch() {
            var records = getRecords();
            // wipe out the records in local storage so tracking can continue while sending
            deleteRecords();

            // only send records if there are records
            if (records.length > 0) {
                $.ajax({
                    url: defaults.trackingEndPoint,
                    dataType: 'json',
                    type: 'post',
                    data: {
                        api: 1,
                        appid: defaults.appid,
                        uniqueid: getLocation(),
                        data: JSON.stringify(records)
                    },
                    success: function(data) {
                        if (data && data.success !== undefined && data.success === true) {
                            // start a new timer for next batch
                            setTimeout(sendBatch, defaults.batchTimer);
                        }
                        else {
                            retry(records);
                        }
                    },
                    error: function() {
                        retry(records);
                    }
                });
            }
            else {
                // nothing to send this time around, start a new timer
                setTimeout(sendBatch, defaults.batchTimer);
            }
        }

        function retry(records) {
            // concat any new records created while trying to send, save them and try again after retryTimeout
            var newRecords = getRecords();
            records.concat(newRecords);
            setRecords(records);
            setTimeout(sendBatch, defaults.retryTimeout);
        }

        function getLocation() {
            return localStorage.getItem('deviceLocation');
        }

        function getPage() {
            var page = $('.pages').not('.hidden').attr('id');

            if (page === 'notices-page') {
                page = $('.notice.index').data('page');
            }

            return {
                name: page
            };
        }

        function getVideo() {
            return $('.carousel .index .video').data('video');
        }

        function makeRecord(options) {
            var event = options.event || events.view;
            var type = options.type || types.view.page;
            var data = options.data || {};

            return {
                event: event,
                type: type,
                data: data,
                datetime: moment().format('YYYY-MM-DD HH:mm:ss'),
                location: getLocation()
            };
        }

        function setRecords(records) {
            localStorage.setItem(defaults.localStorageKey, JSON.stringify(records));
        }

        function getRecords() {
            var records = localStorage.getItem(defaults.localStorageKey);

            if (records === null) {
                return [];
            }

            records = jsonParse(records);

            if (records === null) {
                return [];
            }

            return records;
        }

        function deleteRecords() {
            localStorage.removeItem(defaults.localStorageKey);
        }

        function addRecord(record) {
            var records = getRecords();
            records.push(record);
            setRecords(records);
        }

        return {
            trackClick: trackClick,
            trackPageView: trackPageView
        };
    }

    function Carousel(options) {

        var defaults = {
            tracker: null
        };

        var EVENTS = {
            ONBEGIN: 'begin',
            ONSTART: 'start',
            ONFINISH: 'finish',
            ONSTOP: 'stop',
            ONPAUSE: 'pause',
            ONRESUME: 'resume'
        };

        var readyPlayer = 1;

        init(options);

        /* eslint-disable-next-line */
        function init(options) {
            options = options || {};
            defaults = $.extend(true, {}, defaults, options);

            // hijack Playlist3's video tags
            // we need to remove the existing video tags and replace them with new tags
            // in order to get rid of Playlist3's on ended event
            $('#players').empty();

            var video1 = $('<video controls id="video-1" style="visibility: hidden;"></video>');
            var video2 = $('<video controls id="video-2" style="visibility: hidden;"></video>');

            $('#players').append(video1, video2);
        }

        function html(element) {
            var carousel = $('<div>').addClass('carousel');
            var carouselSlides = $('<div>').addClass('carousel-slides');
            var leftControl = $('<div>').addClass('control left');
            var rightControl = $('<div>').addClass('control right');
            var prevButton = $('<button>').addClass('prev').attr('name', 'carousel-prev').on('click', prev);
            var nextButton = $('<button>').addClass('next').attr('name', 'carousel-next').on('click', next);

            leftControl.append(prevButton);
            rightControl.append(nextButton);

            var videos = getVideoData() || [];

            videos.forEach(function(video) {
                if (video) {
                    carouselSlides.append(slide(video));
                }
            });

            element.append(carousel.append(leftControl).append(rightControl).append(carouselSlides));

            setTimeout(function() {
                $('.video').each(function(index, video) {
                    var videoData = $(video).data('video');

                    if (videoData) {
                        $(video).attr('data-src', encode(videoData.url));
                    }
                });

                $('video').each(function(index, video) {
                    var videoId = $(video).prop('id');

                    bindPlayerEvents(videoId);
                });
            }, 500);
        }

        function getVideoData() {
            var videos = localStorage.getItem('videos');

            try {
                videos = ABNET.jsonParse(videos);

                if (!videos) {
                    videos = [];
                }
            }
            catch (e) {
                videos = [];
            }

            return videos;
        }

        function setVideoData(videos) {
            videos = videos || [];

            localStorage.setItem('videos', JSON.stringify(videos));
        }

        function slide(video) {
            var title = video.title ? video.title : 'Video ' + video.index.toString();
            var likes = video.upvotes ? video.upvotes : 0;
            var dislikes = video.downvotes ? video.downvotes : 0;
            var slide = $('<div>').addClass('carousel-slide hidden');
            var header = $('<h1>').text(title);
            var videoPlayer = getVideo(video);
            var vote = $('<div>').addClass('vote');
            var voteUp = $('<button>').addClass('voteup').attr('name', 'slide-' + video.id + '-voteup');
            var voteDown = $('<button>').addClass('votedown').attr('name', 'slide-' + video.id + '-votedown');

            voteUp.attr('data-video', video.id).text(likes.toString()).on('click', like);
            voteDown.attr('data-video', video.id).text(dislikes.toString()).on('click', dislike);
            vote.append(voteUp).append(voteDown);

            return slide.append(header).append(videoPlayer).append(vote);
        }

        function getVideo(video) {
            var videoDiv = $('<div>').addClass('video');
            var videoData = {
                index: video.index,
                id: video.id,
                filename: video.filename,
                title: video.title,
                url: video.url
            };

            videoDiv.attr('data-video', JSON.stringify(videoData));

            if ($('body').hasClass('large')) {
                videoDiv.attr('width', '1366').attr('height', '768');
            }
            else {
                videoDiv.attr('width', '1024').attr('height', '576');
            }

            return videoDiv;
        }

        function bindPlayerEvents(playerId) {
            var video = $('#' + playerId);

            video.on('play', function() {
                $(carouselInterface).trigger(EVENTS.ONBEGIN);
            });
            video.on('pause', function() {
                $(carouselInterface).trigger(EVENTS.ONPAUSE);
            });
            video.on('ended', function() {
                $(carouselInterface).trigger(EVENTS.ONFINISH);
            });
        }

        function next() {
            var currentSlide = $('.carousel-slide.index');
            var nextSlide = currentSlide.next();

            if (nextSlide.length === 0) {
                nextSlide = $('.carousel-slide').not('.index').first();
                if (nextSlide.length === 0) {
                    return;
                }
            }

            stopPlaying();

            nextSlide.addClass('out-right').delay(200);
            currentSlide.addClass('slide-out-left');

            var videoSrc = nextSlide.find('.video').attr('data-src');
            var videoIndex = JSON.parse(nextSlide.find('.video').attr('data-video')).index;

            load(videoSrc, videoIndex);

            setTimeout(function() {
                currentSlide.removeClass('index');
                currentSlide.removeClass('slide-out-left');
                currentSlide.addClass('hidden');

                defaults.tracker.trackPageView('video');
            }, 1000);

            setTimeout(function() {
                nextSlide.addClass('index').removeClass('hidden').removeClass('out-right');
            }, 500);
        }

        function prev() {
            var currentSlide = $('.carousel-slide.index');
            var prevSlide = currentSlide.prev();

            if (prevSlide.length === 0) {
                prevSlide = $('.carousel-slide').not('.index').last();
                if (prevSlide.length === 0) {
                    return;
                }
            }

            stopPlaying();

            prevSlide.addClass('out-left').delay(200);
            currentSlide.addClass('slide-out-right');

            var videoSrc = prevSlide.find('.video').attr('data-src');
            var videoIndex = JSON.parse(prevSlide.find('.video').attr('data-video')).index;

            load(videoSrc, videoIndex);

            setTimeout(function() {
                currentSlide.removeClass('index');
                currentSlide.removeClass('slide-out-right');
                currentSlide.addClass('hidden');

                defaults.tracker.trackPageView('video');
            }, 1000);

            setTimeout(function() {
                prevSlide.addClass('index').removeClass('hidden').removeClass('out-left');
            }, 500);
        }

        function setIndex(index) {
            var count = $('.carousel-slide').length;
            if (index >= 0 && index < count) {
                $('.carousel-slide').removeClass('index');
                $('.carousel-slide').addClass('hidden');
                $('.carousel-slide').eq(index).addClass('index').removeClass('hidden');
                var videoSrc = $('.carousel-slide.index').find('.video').attr('data-src');
                var videoIndex = JSON.parse($('.carousel-slide.index').find('.video').attr('data-video')).index;

                load(videoSrc, videoIndex);
            }
        }

        function load(videoSrc, videoIndex) {
            var player = document.getElementById('video-' + readyPlayer);

            // if current player already has src and it matches what we want to load, reuse it
            if (player.src) {
                var currentSrc = player.src.slice(player.src.lastIndexOf('/') + 1, player.src.length);
                var newSrc = videoSrc.slice(videoSrc.lastIndexOf('/') + 1, videoSrc.length);

                // player already has this source, make it visible
                if (currentSrc === newSrc) {
                    player.style.visibility = 'visible';
                    return;
                }
            }

            var videoDiv = $('.video').eq(videoIndex - 1);

            readyPlayer = readyPlayer === 1 ? 2 : 1;
            player = document.getElementById('video-' + readyPlayer);

            if (videoDiv.find('#video-' + readyPlayer).length === 0) {
                videoDiv.append(player);
                player.src = videoSrc;
                player.style.visibility = 'visible';
                player.load();
            }
            else {
                player.style.visibility = 'visible';
            }

            // automatically start the video
            player.play();
        }

        function stopPlaying() {
            var player = document.getElementById('video-' + readyPlayer);

            player.pause();
        }

        function like(e) {
            var videoId = parseInt($(e.currentTarget).data('video'));
            var currentLikes = parseInt(e.currentTarget.innerText) + 1;

            $(e.currentTarget).text(currentLikes);
            $(e.currentTarget).attr('disabled', true);
            $(e.currentTarget).parent().find('.votedown').attr('disabled', true);
            defaults.tracker.trackClick('vote', {
                name: 'like'
            });
            likeVideo(videoId);
        }

        function dislike(e) {
            var videoId = parseInt($(e.currentTarget).data('video'));
            var currentDislikes = parseInt(e.currentTarget.innerText) + 1;

            $(e.currentTarget).text(currentDislikes);
            $(e.currentTarget).attr('disabled', true);
            $(e.currentTarget).parent().find('.voteup').attr('disabled', true);
            defaults.tracker.trackClick('vote', {
                name: 'dislike'
            });
            dislikeVideo(videoId);
        }

        function likeVideo(id) {
            var videos = getVideoData();

            videos.forEach(function(video) {
                if (video.id === id.toString()) {
                    if (video.upvotes) {
                        video.upvotes = video.upvotes + 1;
                    }
                    else {
                        video.upvotes = 1;
                    }
                }
            });

            setVideoData(videos);
            updateVideoVotes(videos);
        }

        function dislikeVideo(id) {
            var videos = getVideoData();

            videos.forEach(function(video) {
                if (video.id === id.toString()) {
                    if (video.downvotes) {
                        video.downvotes = video.downvotes + 1;
                    }
                    else {
                        video.downvotes = 1;
                    }
                }
            });

            setVideoData(videos);
            updateVideoVotes(videos);
        }

        function updateVideoVotes(videos) {
            videos = videos || getVideoData();

            if (videos && videos.length) {
                videos.forEach(function(video) {
                    var span = $('#video-' + video.id + '-likes');

                    if (span.length) {
                        var likeText = video.upvotes === 1 ? 'Like' : 'Likes';

                        span.text(video.upvotes.toString() + ' ' + likeText);
                    }
                });
            }
        }

        var carouselInterface = {
            html: html,
            setIndex: setIndex,
            stopPlaying: stopPlaying
        };

        return carouselInterface;
    }

    function startAppTimer() {
        stopAppTimer(true);

        var appTimer = $('<div id="apptimer" class="bg1"></div>');

        appTimer.append('<div><label id="minutes">10</label>:<label id="seconds">00</label></div>');

        $('body').append(appTimer);

        var totalSeconds = 10 * 60;
        var seconds = $('#seconds');
        var minutes = $('#minutes');

        function pad(val) {
            var valString = val + '';

            if (valString.length < 2) {
                return '0' + valString;
            }
            else {
                return valString;
            }
        }

        APPTIMER = setInterval(function() {
            --totalSeconds;

            if (totalSeconds >= 0) {
                seconds.text(pad(totalSeconds % 60));
                minutes.text(pad(parseInt(totalSeconds / 60)));
            }
            else {
                stopAppTimer(false);
            }
        }, 1000);
    }

    function stopAppTimer(remove) {
        clearInterval(APPTIMER);
        APPTIMER = null;

        if (remove) {
            $('#apptimer').remove();
            localStorage.setItem('oopsscreen', false);
        }
        else {
            $('#apptimer').empty().removeClass('bg1').addClass('bg2');
            localStorage.setItem('oopsscreen', true);
        }
    }

    var sendMessageInterval = null;
    var sendMessageConnection = null;

    function wsDeviceStatus() {
        sendMessageConnection = new WebSocket(WEBSOCKET_URL);

        function sendDeviceInfo() {
            PLATFORM.deviceInfoToObject().then(function(deviceInfo) {
                debug.log('ABNET deviceInfo:', deviceInfo);

                wsSend('sendmessage', deviceInfo);
            });
        }

        function wsSend(action, data) {
            if (sendMessageConnection && sendMessageConnection.readyState === WebSocket.OPEN) {
                var message = data;

                message.action = action;

                sendMessageConnection.send(JSON.stringify(message));
            }
        }

        sendMessageConnection.onopen = function() {
            if (!sendMessageInterval) {
                sendMessageInterval = setInterval(sendDeviceInfo, WEBSOCKET_INTERVAL);
                sendDeviceInfo();
            }
        };

        sendMessageConnection.onmessage = function(msg) {
            debug.log('wsDeviceStatus received message:', msg);
            var message = jsonParse(msg.data);

            switch (message.command) {
                case 'LOGGING':
                    debug.toggle();
                    // send immediate response
                    sendDeviceInfo();
                    break;
                case 'REBOOT':
                case 'RESTART':
                    PLATFORM.process([{ action: message.command }]);
                    break;
                case 'UNZIP':
                    PLATFORM.process([{ action: message.command, params: message.params }]);
                    break;
                case 'SCREENSHOT':
                    screenshot.timer(message.params);
                    break;
                default:
                    break;
            }
        };

        sendMessageConnection.onerror = function() {
            sendMessageConnection.close();
        };

        sendMessageConnection.onclose = function() {
            setTimeout(function() {
                wsDeviceStatus();
            }, 1000);
        };
    }

    function getClient() {
        var server = SERVER_URL.replace('http://', '').replace('https://', '');
        var client = server.slice(0, server.indexOf('.'));

        return client;
    }

    var screenshot = {};

    screenshot.ssTimer = null;
    screenshot.interval = null;
    screenshot.handle = null;

    screenshot.timer = function (newInterval) {
        if (newInterval) {
            this.interval = parseInt(newInterval);

            if (this.handle) {
                clearTimeout(this.handle);
                this.handle = null;
            }

            // set reset timeout
            this.handle = setTimeout(this.timer, SCREENSHOT_INTERVAL);
        }
        else {
            this.interval = SCREENSHOT_INTERVAL;
        }

        localStorage.setItem('screenshotinterval', this.interval);

        this.stop();
        this.start();
    };

    screenshot.stop = function () {
        if (this.ssTimer) {
            clearInterval(this.ssTimer);
            this.ssTimer = null;
        }
    };

    screenshot.start = function () {
        if (!this.ssTimer) {
            this.ssTimer = setInterval(function() {
                PLATFORM.screenShot();
            }, this.interval);

            // first screenshot
            PLATFORM.screenShot();
        }
    };

    screenshot.put = function (base64) {
        var client = getClient();
        var macAddress = localStorage.getItem('mac');
        var url = SCREENSHOT_URL + '?file=' + client + '.' + macAddress + '.jpg';
        var data = this.convertDataURIToBinary(base64);

        debug.log('ABNET putScreenShot:', url);

        $.ajax({
            url: url,
            type: 'POST',
            contentType: 'image/jpeg',
            data: data,
            processData: false
        });
    };

    screenshot.convertDataURIToBinary = function (dataURI) {
        var BASE64_MARKER = ';base64,';
        var base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
        var base64 = dataURI.substring(base64Index);
        var raw = window.atob(base64);
        var rawLength = raw.length;
        var array = new Uint8Array(new ArrayBuffer(rawLength));

        for(var i = 0; i < rawLength; i++) {
            array[i] = raw.charCodeAt(i);
        }

        return array;
    };

    /**
     * Expose constants and methods
     */
    return {
        DEVICE_NAME: DEVICE_NAME,
        DEVICE_LOCATION: DEVICE_LOCATION,
        DEVICE_COMPANY: DEVICE_COMPANY,
        SERVER_URL: SERVER_URL,
        UPDATE_URL: UPDATE_URL,
        MANAGEMENT_URL: MANAGEMENT_URL,
        IDENTITY_CHECK_INTERVAL: IDENTITY_CHECK_INTERVAL,
        MANAGEMENT_INTERVAL: MANAGEMENT_INTERVAL,
        MASTER_IP: MASTER_IP,
        SCREENSHOT_INTERVAL: SCREENSHOT_INTERVAL,
        encode: encode,
        onScreenLog: onScreenLog,
        checkUpdates: checkUpdates,
        getFileExt: getFileExt,
        currency: currency,
        jsonParse: jsonParse,
        getPlaylist: getPlaylist,
        isPreviewMode: isPreviewMode,
        NextGenApp: NextGenApp,
        PlatformUtils: PlatformUtils,
        Tracker: Tracker,
        Carousel: Carousel,
        wsDeviceStatus: wsDeviceStatus,
        screenshot: screenshot,
        debug: debug
    };

})();
