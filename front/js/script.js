/*
 * Copyright 2011-2022 Abierto Networks, LLC.
 * All rights reserved.
 */

/* global $, ABCONST, ABNET, moment, DEVICE_ID, PLATFORM */

var APP = (function() {
    var carousel;
    var tracker;
    var videoPlaying = false;
    var started = false;
    var eventsBound = false;

    function init() {
        $(document).on('nextgenapp:rendered', bindEvents);

        // load extras.css
        ABNET.PlatformUtils.loadCSS('front/css/extras.css');

        if (!ABNET.isPreviewMode()) {
            ABNET.NextGenApp.init({ playlistControls: true, controlsTimeout: false });
        }
        else {
            ABNET.NextGenApp.init();
        }
    }

    function bindEvents() {
        if (eventsBound) {
            return;
        }

        $(this).on('content:changed', localAppData);
        $(this).on('nextgenapp:rendered', downloadsFinished);

        // suppress context menu and tap-and-hold
        window.addEventListener('contextmenu', function(e) {
            e.preventDefault();
        });
        document.body.ondragstart = function() {
            return false;
        };

        // fix double tap issue on linux kiosks
        $(this).on('click', function() {
            $(this).triggerHandler('dblclick');
        });

        // reset inactivity timeout on click
        $(this).on('click', resetInactivityTimer);

        tracker = ABNET.Tracker();

        // support 21" kiosks
        if ($(window).width() > 1366) {
            $('body').addClass('large');
        }

        if (!ABNET.isPreviewMode()) {
            setInterval(getAppData, ABNET.IDENTITY_CHECK_INTERVAL);
            getAppData();
        }

        eventsBound = true;
    }

    function loadApp() {
        initPages();
        gotoPage('pages-content');
    }

    function initPages() {
        initHomePage();
        initNoticesPage();
        initAmberAlerts();
    }

    function getAppData() {
        var url = ABNET.SERVER_URL + '/ajax/appdata';
        var uid = typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : localStorage.getItem('deviceLocation');

        $.ajax({
            type: 'get',
            url: url,
            cache: false,
            data: {
                api: 1,
                appid: ABCONST.APP_ID,
                uid: uid
            },
            success: function(data) {
                var old = localStorage.getItem('items');
                var items = JSON.stringify(data);

                if (!started || old !== items) {
                    localStorage.setItem('items', JSON.stringify(data));
                    if (data && data.questions) {
                        localStorage.setItem('questions', JSON.stringify(data.questions));
                    }
                    if (data && data.messages) {
                        localStorage.setItem('messages', JSON.stringify(data.messages));
                    }
                    if (data && data.alerts) {
                        localStorage.setItem('amberalerts', JSON.stringify(data.alerts));
                    }
                    if (data && data.extras) {
                        localStorage.setItem('extras', JSON.stringify(data.extras));
                    }
                    loadApp();
                    localAppData(null, true);

                    started = true;
                }
            },
            error: function() {}
        });
    }

    function localAppData(e, finishDownloads) {
        finishDownloads = finishDownloads || false;

        var storedata = null;

        try {
            var items = ABNET.jsonParse(localStorage.getItem('items'));

            if (items === undefined) {
                return;
            }

            storedata = items.data || {};
        }
        catch (e) {
            storedata = [];
        }

        if (finishDownloads) {
            downloadsFinished();
        }
        processStoreData(storedata);
    }

    function downloadsFinished() {
        var received = ABNET.getPlaylist(false);

        getTagsForSlides(received);
    }

    function getTagsForSlides(slides) {
        var url = ABNET.SERVER_URL + '/ajax/gettagsforslides';
        var ids = [];

        slides.forEach(function(slide) {
            ids.push(slide.id);
        });

        $.ajax({
            type: 'get',
            url: url,
            dataType: 'json',
            data: {
                api: 1,
                appid: ABCONST.APP_ID,
                ids: JSON.stringify(ids)
            },
            success: function(tags) {
                processSlideTags(slides, tags);
            },
            error: function() {}
        });
    }

    function processSlideTags(slides, tags) {
        slides.forEach(function(slide) {
            tags.forEach(function(tag) {
                if (slide.id === tag.id) {
                    slide.tags = tag.tags;
                }
            });
        });

        renderPlaylist(slides);
    }

    function renderPlaylist(slides) {
        var slideIndex = 0;
        var videos = [];

        slides.forEach(function(slide) {
            var content = slide.content || '';
            var url = slide.name;

            if (slide.path) {
                url = PLATFORM.STORE + slide.path + '/' + slide.name;
            }

            var category = getCategoryFromTags(slide.tags);
            var question = getQuestionFromTags(slide.tags);
            var link = getLinkFromTags(slide.tags);
            var ext = slide.name.split('.').pop();

            if (slide.content !== null && ext !== 'mp4') {
                slideIndex += 1;

                localStorage.setItem('slide.' + slideIndex, JSON.stringify({
                    id: slide.id,
                    category: category,
                    content: content,
                    filename: slide.name,
                    question: question,
                    url: url,
                    link: link
                }));
            }
            else if (slide.content !== null && ext === 'mp4') {
                var videoTitle = '';
                var videoIndex = 0;

                slide.tags.forEach(function(tag) {
                    if (tag.name.indexOf('Video ') === 0) {
                        videoIndex = parseInt(tag.name.slice(6, 7));

                        videoTitle = tag.name.slice(8, tag.name.length);
                    }
                });

                if (!videoTitle) {
                    videoIndex = videos.length + 1;

                    videoTitle = slide.name.replace('.mp4', '');
                }

                if (videos.length < 5) {
                    videos.push({
                        index: videoIndex,
                        id: slide.id,
                        category: category,
                        content: content,
                        datetime: slide.notbefore,
                        filename: slide.name,
                        title: videoTitle,
                        question: question,
                        tags: slide.tags,
                        url: url,
                        link: link,
                        upvotes: 0,
                        downvotes: 0
                    });
                }
            }
        });

        setVideos(sortVideos(videos));
        // wait a few seconds before initializing videos pages
        // because they reuse playlist3's video tags
        setTimeout(function() {
            $('#videos-page').remove();
            $('#video-page').remove();
            initVideosPage();
            initVideoPage();
        }, 3000);
        question();
        slideShow();
        gotoPage('pages-content', true);
    }

    function sortVideos(videos) {
        var sorted = [];

        // sort videos by index
        for (var i = 1; i <= 5; i++) {
            videos.forEach(function(video) {
                if (video.index === i) {
                    sorted.push(video);
                }
            });
        }

        return sorted;
    }

    function getCategoryFromTags(tags) {
        var categoryId = 0;

        tags.forEach(function(tag) {
            ABCONST.CATEGORIES.forEach(function(category) {
                if (tag.name === category.name) {
                    categoryId = category.id;
                }
            });
        });

        return categoryId;
    }

    function getQuestionFromTags(tags) {
        var questionId = 0;

        tags.forEach(function(tag) {
            ABCONST.QUESTIONS.forEach(function(question) {
                if (tag.name === question.name) {
                    questionId = question.id;
                }
            });
        });

        return questionId;
    }

    function getLinkFromTags(tags) {
        var url = '';

        tags.forEach(function(tag) {
            ABCONST.LINKS.forEach(function(link) {
                if (tag.name === link.name) {
                    url = link.link;
                }
            });
        });

        return url;
    }

    function processStoreData(data) {
        if (data === null || data === undefined) {
            return;
        }

        var hack = {
            C400AD453395: '79',
            C400AD453383: '676',
            C400AD453357: '709',
            C400AD453325: '696',
            C400AD453317: '334',
            C400AD453311: '545',
            C400AD453295: '340',
            C400AD453287: '685',
            C400AD453281: '712',
            C400AD453277: '679',
            C400AD453265: '690',
            C400AD45339B: '3',
            C400AD45336B: '241',
            C400AD45335D: '100',
            C400AD45332F: '698',
            C400AD45332B: '176',
            C400AD45331D: '687',
            C400AD45330B: '694',
            C400AD45328D: '277',
            C400AD45327D: '688',
            C400AD4533B3: '710',
            C400AD4533A3: '702',
            C400AD4532FD: '692',
            C400AD4532FB: '231',
            C400AD4532EF: '211',
            C400AD4532E9: '693',
            C400AD4532E3: '689',
            C400AD4532DB: '379',
            C400AD4532C7: '700',
            C400AD4532BF: '514',
            C400AD4532B9: '686',
            C400AD4532AF: '7',
            C400AD4532AB: '706',
            C400AD792F65: '255',
            C400AD792F53: '373',
            C400AD792F4B: '292',
            C400AD792E1C: '351',
            C400AD792DBA: '189',
            C400AD792CBE: '41',
            C400AD470FA5: '691',
            C400AD470FA3: '650',
            C400AD470F97: '704',
            C400AD470F91: '708',
            C400AD470F43: '354',
            C400AD470F26: '705',
            C400AD470F9C: '684',
            C400AD470F7E: '683',
            C400AD470F3A: '713',
            C400AD470F1C: '695',
            C400AD470EE4: '680',
            C400AD470EC7: '697',
            C400AD470E84: '355',
            C400AD470E82: '186',
            C400AD470E74: '707',
            C400AD470E7C: '682',
            '000732397765': '681',
            '000732397557': '122',
            '000732320651': '61',
            '0007323975A7': '555',
            '0007323D84E0': '557'
        };
        var deviceLocation = localStorage.getItem('deviceLocation');
        var store = [];

        if (hack[deviceLocation]) {
            store.push(hack[deviceLocation]);
        }
        else {
            store.push(deviceLocation);
        }

        // birthdays
        if (data.data1 !== null && data.data1 !== undefined) {
            var birthdays = {
                class: 'birthday',
                content: data.data1
            };
            localStorage.setItem('notice.1', JSON.stringify(birthdays));
        }

        // anniversaries
        if (data.data2 !== null && data.data2 !== undefined) {
            var anniversaries = {
                class: 'anniversary',
                content: data.data2
            };
            localStorage.setItem('notice.2', JSON.stringify(anniversaries));
        }

        // sales, ahod, friendliness
        if (data.data3 !== null && data.data3 !== undefined) {
            var fb = {
                class: 'fb50k',
                content: store.concat(data.data3[0])
            };
            localStorage.setItem('notice.3', JSON.stringify(fb));
        }

        // NOTE: data4 is the extra page under My Store, normally SFTK
        if (data.data4 !== null && data.data4 !== undefined) {
            var extra = {
                class: 'extra',
                content: store.concat(data.data4)
            };
            localStorage.setItem('notice.4', JSON.stringify(extra));
        }

        // NOTE: data5 is the extra slide on the home page, normally SheetzFest
        if (data.data5 !== null && data.data5 !== undefined) {
            extra = {
                class: 'extra',
                content: store.concat(data.data5)
            };

            localStorage.setItem('notice.5', JSON.stringify(extra));
            // to rebuild the special SheetzFEST slide
            slideShow();
        }

        initNoticesPage();
        gotoPage('pages-content', true);
    }

    function gotoPage(page, reset, index) {
        clearTimeout(ABCONST.TIMERS.pageview.timer);
        ABCONST.TIMERS.pageview.timer = null;

        page = whichPage(page);
        reset = reset || false;
        index = index !== undefined && index !== null ? index : 0;

        if (reset) {
            $('.menu-popout').removeClass('slide-left');
            $('.controls-popout').removeClass('slideup');
            $('.question-popout').remove();
            $('.voteup').attr('disabled', false);
            $('.votedown').attr('disabled', false);

            // on reset, delay going to next page to give
            // css animations enough time to finish
            setTimeout(function() {
                if (!$('.playpause').hasClass('pause')) {
                    $('.playpause').triggerHandler('click');
                }
                $('#pages-content').show();
                $('.playlist-controls').show();
                $('.menu-popout').show();
                gotoPage(page, false, index);
            }, 550);

            return;
        }

        if (page !== '#pages-content') {
            if ($('.playpause').hasClass('pause')) {
                $('.playpause').triggerHandler('click');
            }
            $('#pages-content').hide();
            $('.playlist-controls').hide();
            $('.menu-popout').hide();
        }

        if (page === '#video-page') {
            setVideoIndex(index);
        }

        if (page === '#notices-page') {
            setNoticeIndex(index);
        }

        $('.pages').addClass('hidden');
        $(page).removeClass('hidden');

        if (page.indexOf('#') === 0) {
            page = page.slice(1, page.length);
        }

        if (!reset && tracker !== undefined) {
            if (page === 'notices-page') {
                ABCONST.TIMERS.pageview.timer = setTimeout(
                    function() {
                        tracker.trackPageView('page');
                    },
                    ABCONST.TIMERS.pageview.timeout
                );
            }
            else if (page === 'videos-page') {
                tracker.trackPageView('page');
            }
            else if (page === 'video-page') {
                tracker.trackPageView('video');
            }
        }
    }

    function whichPage(page) {
        if (typeof page === 'object') {
            try {
                page = '#' + page.data.page;
            }
            catch (e) {
                page = '#pages-content';
            }
        }
        else if (typeof page === 'string') {
            if (page.indexOf('#') === -1) {
                page = '#' + page;
            }
        }
        else {
            page = '#pages-content';
        }

        return page;
    }

    function getPage(id) {
        id = id !== undefined ? id : 'pages-content';
        var page = $('#' + id).empty();

        if (page.length === 0) {
            $('body').append($('<div>').attr('id', id).addClass('pages hidden'));
            page = $('#' + id);
        }

        return page;
    }

    function getSlideIndex() {
        var index = 0;

        $('.slide').each(function(idx, slide) {
            if ($(slide).css('visibility') === 'visible') {
                index = idx;
            }
        });

        return index;
    }

    function getSlide() {
        var index = getSlideIndex();
        var slide = JSON.parse(localStorage.getItem('slide.' + (index + 1)));

        if (slide) {
            return {
                category: slide.category,
                id: slide.id,
                filename: slide.filename
            };
        }
        else {
            return {};
        }
    }

    function initHomePage() {
        // append questions, menu and amber alert
        $(document).on('playlist3:showslide', function() {
            var page = $('#pages-content');

            if (!$('ul.questions').length) {
                page.append(question());
            }

            $('ul.menu').remove();
            $('div.menu-popout').remove();
            page.append(menu());

            if (!$('button.amberalerts').length) {
                page.append(amberAlertButton());
            }
        });

        $(document).on('playlist3:showslide', function(e, index) {
            // get slide from local storage
            var slide = JSON.parse(localStorage.getItem('slide.' + (index + 1)));

            $('.questions button').hide();

            if (slide) {
                var question = '.question-' + slide.question;

                $(question).show();
            }
        });

        // bind playlist3 control click events
        $(document).on('playlist3:play', function(e) {
            if (e.originalEvent !== undefined) {
                resetInactivityTimer();

                tracker.trackClick('control', { name: 'play', slide: getSlide() });
            }
        });

        $(document).on('playlist3:pause', function(e) {
            if (e.originalEvent !== undefined) {
                resetInactivityTimer();

                tracker.trackClick('control', { name: 'pause', slide: getSlide() });
            }
        });

        $(document).on('playlist3:next', function() {
            resetInactivityTimer();

            tracker.trackClick('control', { name: 'next', slide: getSlide() });
        });

        $(document).on('playlist3:previous', function() {
            resetInactivityTimer();

            tracker.trackClick('control', { name: 'previous', slide: getSlide() });
        });

        $(document).on('playlist3:showControls', function() {
            resetInactivityTimer();
        });

        $(document).on('playlist3:hideControls', function() {
            resetInactivityTimer();
        });

        $(document).on('question-show', function() {
            if ($('.playpause').hasClass('pause')) {
                $('.playpause').addClass('was-playing').triggerHandler('click');
            }
        });

        $(document).on('question-hide', function() {
            if ($('.playpause').hasClass('was-playing')) {
                $('.playpause').removeClass('was-playing').triggerHandler('click');
            }
        });
    }

    function slideShow(force) {
        var slideShow = $('#pages-content .dayparts');
        var resetPlaylist = force || false;

        if (ABCONST.SPECIAL_SLIDE) {
            var specialSlide = specialSheetzFest();

            var enableExtraSlide = getExtras('slide');

            if (enableExtraSlide) {
                slideShow.append(specialSlide);
                resetPlaylist = true;
            }
            else {
                $('#special-sheetz-fest').remove();
                resetPlaylist = true;
            }
        }

        if (ABCONST.TIMERS.messages.timer) {
            var messageSlide = myStoreMessageSlide();

            if (messageSlide) {
                slideShow.append(messageSlide);
                resetPlaylist = true;
            }
        }
        else {
            $('#mystore-message').remove();
        }

        $('.dayparts .slide').each(function(idx, slide) {
            if ($(slide).hasClass('video')) {
                $(slide).remove();
                resetPlaylist = true;
            }
        });

        $('video').each(function(idx, video) {
            video.style.visibility = 'hidden';
        });

        if (resetPlaylist) {
            $(document).trigger('nextgenapp:resetplaylist');
        }
    }

    // determine if the extra page or slide should be enabled
    // pass in 'page' or 'slide' and get back true or false
    function getExtras(which) {
        which = (which === 'page') ? 0 : 1;

        var parsed = ABNET.jsonParse(localStorage.getItem('extras'));

        if (!parsed) {
            return false;
        }

        if (parsed.length && parsed[which]) {
            return parsed[which] === 'true';
        }

        return false;
    }

    function getLocalQuestions() {
        var defaultQuestions = [{
            id: 1,
            text: 'Would you like to keep seeing content similar to this?'
        }];

        try {
            var parsed = ABNET.jsonParse(localStorage.getItem('questions'));

            if (!parsed) {
                return defaultQuestions;
            }

            if (parsed.length) {
                return parsed;
            }
            else {
                return defaultQuestions;
            }
        }
        catch (e) {
            return defaultQuestions;
        }
    }

    function question() {
        var questions = getLocalQuestions();

        if (questions.length === 0) {
            return;
        }

        var ul = $('.questions').empty();

        if (ul.length === 0) {
            ul = $('<ul>').addClass('questions');
        }

        questions.forEach(function(question) {
            var id = question.id || 0;
            var text = question.text || 'Would you like to keep seeing content similar to this?';

            function answer(e) {
                tracker.trackClick('feedback', {
                    question: text,
                    answer: $(e.currentTarget).prop('name'),
                    slide: getSlide()
                });

                closeQuestion();
            }

            function closeQuestion() {
                $(document).trigger('question-hide');
                $('.question-popout').remove();
            }

            function dontCloseQuestion(e) {
                e.stopPropagation();
            }

            function askQuestion() {
                $(document).trigger('question-show');

                var popOut = $('<div>')
                    .addClass('question-popout')
                    .on('click', closeQuestion);

                var wrapper = $('<div>')
                    .addClass('question')
                    .attr('data-question', id)
                    .attr('data-question-text', text)
                    .on('click', dontCloseQuestion);

                var question = $('<p>')
                    .text(text);

                var yesButton = $('<button>')
                    .addClass('button yes')
                    .on('click', answer)
                    .attr('name', 'yes');

                var noButton = $('<button>')
                    .addClass('button no')
                    .on('click', answer)
                    .attr('name', 'no');

                var closeMenuButton = $('<button>')
                    .addClass('menu-close')
                    .on('click', closeQuestion)
                    .attr('name', 'close');

                wrapper.append(question, yesButton, noButton, closeMenuButton);
                popOut.append(wrapper);

                $('body').append(popOut);
            }

            var questionName = 'question-' + id.toString();

            var button = $('<button>')
                .addClass(questionName)
                .attr('data-question', id)
                .on('click', askQuestion)
                .attr('name', questionName);

            var li = $('<li>').append(button);

            ul.append(li);
        });

        return ul;
    }

    function menu() {
        function openMenu() {
            $('.menu-popout').addClass('slide-left');
        }

        function closeMenu() {
            $('.menu-popout').removeClass('slide-left');
        }

        var videos = getVideos();
        var newLabel = getNewLabel(videos);
        var newLabel2 = getNewLabel(videos);

        var openMenuButton = $('<button>')
            .addClass('menu-open')
            .attr('name', 'menu-open')
            .on('click', openMenu);

        var menu = $('<ul>')
            .addClass('menu')
            .append($('<li>')
                .append(newLabel, openMenuButton));

        var videosButton = $('<button>')
            .addClass('videos')
            .attr('name', 'menu-videos')
            .on('click', {
                page: 'videos-page'
            }, gotoPage);

        var myStoreButton = $('<button>')
            .addClass('mystore')
            .attr('name', 'menu-mystore')
            .on('click', {
                page: 'notices-page'
            }, gotoPage);

        var ul = $('<ul>')
            .append($('<li>')
                .append(newLabel2, videosButton))
            .append($('<li>')
                .append(myStoreButton));

        var closeMenuButton = $('<button>')
            .addClass('menu-close')
            .on('click', closeMenu)
            .attr('name', 'question-close');

        var popout = $('<div>')
            .addClass('menu-popout')
            .append(ul, closeMenuButton);

        return menu.add(popout);
    }

    function amberAlertButton() {
        // remove existing button first
        $('button.amberalerts').remove();

        var alerts = ABNET.jsonParse(localStorage.getItem('amberalerts'));

        if (!Array.isArray(alerts)) {
            alerts = [alerts];
        }

        if (!alerts || !alerts.length) {
            return '';
        }

        var buttonText = 'AMBER ALERT!';

        if (alerts.length > 1) {
            buttonText = 'AMBER ALERTS!';
        }

        var alertButton = $('<button class="amberalerts">' + buttonText + '</button>').on('click', function() {
            $('#amberalert').removeClass('hidden');
        });

        // clear the amber alert timer if there is one
        if (ABCONST.TIMERS.amberalert.timer) {
            clearTimeout(ABCONST.TIMERS.amberalert.timer);
            ABCONST.TIMERS.amberalert.timer = null;
            ABCONST.TIMERS.amberalert.timeout = 0;
        }

        var displayUntil = 0;
        // loop through alerts and find the latest displayUntil date
        alerts.forEach(function(alert) {
            if (alert && alert.displayUntil) {
                var date = moment(alert.displayUntil, 'MM/DD/YYYY');

                if (date.valueOf() > displayUntil) {
                    displayUntil = date.valueOf();
                }
            }
        });

        // if no display until found, default to 3 weeks
        if (!displayUntil) {
            displayUntil = moment().add(3, 'weeks').valueOf();
        }

        // calculate how long to show the amber alert
        ABCONST.TIMERS.amberalert.timeout = displayUntil - moment().valueOf();

        // don't render the button if it's timeout has already expired
        if (ABCONST.TIMERS.amberalert.timeout <= 0) {
            return '';
        }

        // limit timeout to MAX_TIMEOUT
        if (ABCONST.TIMERS.amberalert.timeout > ABCONST.TIMERS.amberalert.maxTimeout) {
            ABCONST.TIMERS.amberalert.timeout = ABCONST.TIMERS.amberalert.maxTimeout;
        }

        // start amber alert timer
        ABCONST.TIMERS.amberalert.timer = setTimeout(function() {
            $('button.amberalerts').remove();
        }, ABCONST.TIMERS.amberalert.timeout);

        return alertButton;
    }

    function initVideosPage() {
        var page = getPage('videos-page');
        var header = $('<h1>').text('Videos');
        page.append(header);

        var row = $('<div>').addClass('row');
        var videos = getVideos();

        videos.forEach(function(video, index) {
            if (video) {
                if (index === ABCONST.VIDEO_PER_ROW) {
                    page.append(row);
                    row = $('<div>').addClass('row');
                }
                row = row.append(getVideoBucket(video));
            }
        });

        page.append(row);
        page.append(navigation());
    }

    function getVideos() {
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

    function setVideos(videos) {
        videos = updateVideoData(videos);
        localStorage.setItem('videos', JSON.stringify(videos));
    }

    function updateVideoData(updatedVideos) {
        var currentVideos = getVideos();
        var results = [];

        updatedVideos.forEach(function(updatedVideo) {
            if (updatedVideo && updatedVideo.id) {
                updatedVideo.upvotes = 0;
                updatedVideo.downvotes = 0;

                results.push(updatedVideo);
            }
        });

        if (currentVideos.length && results.length) {
            results.forEach(function(updatedVideo) {
                currentVideos.forEach(function(currentVideo) {
                    if (updatedVideo.id === currentVideo.id) {
                        updatedVideo.upvotes = currentVideo.upvotes ? currentVideo.upvotes : 0;
                        updatedVideo.downvotes = currentVideo.downvotes ? currentVideo.downvotes : 0;
                    }
                });
            });
        }

        return results;
    }

    function getVideoBucket(video) {
        if (video.id === undefined) {
            return;
        }

        var gif = video.filename.replace('.mp4', '.gif');
        var thumbnail = ABNET.encode(video.url.replace(video.filename, '.sprites/' + gif));
        var likes = video && video.upvotes ? video.upvotes : 0;
        var likeText = likes === 1 ? 'Like' : 'Likes';
        var title = video && video.title ? video.title : 'Video ' + video.index;
        var newLabel = getNewLabel(video);
        var bucket = $('<div>').addClass('bucket');
        var span = $('<span>').attr('id', 'video-' + video.id + '-likes').text(likes.toString() + ' ' + likeText);
        var button = $('<button>').addClass('video-thumbnail button' + video.id)
            .css('background', 'url("' + thumbnail + '") no-repeat')
            .css('background-size', 'cover')
            .css('background-color', '#fff')
            .attr('name', title)
            .attr('data-index', video.index)
            .on('click', function() {
                gotoPage('video-page', false, video.index);
            });
        var small = $('<small>').text(title);

        return bucket.append(span).append(newLabel).append(button).append(small);
    }

    function getNewLabel(item) {
        var newLabel = $('<div>');
        var today = moment();
        var yesterday = moment();

        yesterday.subtract(1, 'day');

        if (Array.isArray(item)) {
            item.forEach(function(entry) {
                if (entry) {
                    var date = moment(entry.datetime);

                    if (yesterday.valueOf() < date.valueOf() && date.valueOf() < today.valueOf()) {
                        newLabel = $('<div>').addClass('new-label');
                    }
                }
            });
        }
        else {
            if (item) {
                var date = moment(item.datetime);

                if (yesterday.valueOf() < date.valueOf() && date.valueOf() < today.valueOf()) {
                    newLabel = $('<div>').addClass('new-label');
                }
            }
        }

        return newLabel;
    }

    function navigation(options) {
        options = options || {};

        var onHome = options.onHome || null;
        var onBack = options.onBack || null;

        var nav = $('<div>').addClass('nav');
        var homeButton = $('<button>')
            .addClass('home')
            .attr('name', 'navigation-home')
            .on('click', function() {
                gotoPage('pages-content', true);

                if (typeof onHome === 'function') {
                    onHome();
                }
            });

        if (typeof onBack === 'function') {
            var backButton = $('<button>').addClass('back').on('click', onBack);

            backButton.attr('name', 'navigation-back');
            nav.append(backButton);
        }

        nav.append(homeButton);

        return nav;
    }

    function initVideoPage() {
        var page = getPage('video-page');

        carousel = ABNET.Carousel({
            tracker: tracker
        });

        bindCarouselEvents(carousel);

        carousel.html(page);
        page.append(navigation({
            onHome: function() {
                // wait before stopping to match pages-content reset delay
                setTimeout(function() {
                    carousel.stopPlaying();
                }, 500);
            },
            onBack: function() {
                carousel.stopPlaying();
                $('video').css('visibility', 'hidden');
                gotoPage('videos-page');
            }
        }));
    }

    function bindCarouselEvents(carousel) {
        function videoStarted() {
            videoPlaying = true;
            cancelInactivityTimer();
        }

        function videoEnded() {
            videoPlaying = false;
            resetInactivityTimer();
        }

        $(carousel).on('begin', videoStarted);
        $(carousel).on('resume', videoStarted);
        $(carousel).on('finish', videoEnded);
        $(carousel).on('pause', videoEnded);
        $(carousel).on('stop', videoEnded);
    }

    function setVideoIndex(index) {
        index = index ? index - 1 : 0;
        carousel.setIndex(index);
    }

    function initNoticesPage() {
        var page = getPage('notices-page');

        ABCONST.NOTICES.forEach(function(notice) {
            page.append(getNoticeHtml(notice));
        });

        page.append(noticesNav());
        page.append(navigation());
    }

    function initAmberAlerts() {
        function get(object, propertyName, defaultValue) {
            defaultValue = defaultValue || '';

            if (Array.isArray(propertyName)) {
                var result = propertyName.reduce(function(o, p) {
                    return get(o, p, defaultValue);
                }, object);

                if ($.isEmptyObject(result)) {
                    return defaultValue;
                }
                else {
                    return result;
                }
            }

            var objectSafe = object || {};

            return objectSafe[propertyName] || defaultValue;
        }

        function getAlertPageName(page, alert, index) {
            var pageName = page + '-';

            if (alert.amberalertid) {
                pageName += alert.amberalertid;
            }
            else {
                pageName += (index + 1);
            }

            return pageName;
        }

        function renderChild(child, missingDate, lastSeenAddress) {
            var childName = get(child, ['PersonGivenName']) + ' ' + get(child, ['PersonSurName']);
            var childImage = get(child, ['PhysicalDescription', 'Picture', 'ExternalPicture', 'ImageUrl']);
            var content = '';

            content += '<div class="bucket2">';
            content += '<p class="name">' + childName + '</p>';
            content += '<div class="photo">';

            if (childImage) {
                content += '<img src="' + childImage + '" title="' + childName + '">';
            }

            content += '</div>'; // .photo
            content += '<div class="labels">';
            content += '<ul>';

            ABCONST.AMBERLABELS.forEach(function(label) {
                content += '<li>' + label + '</li>';
            });

            content += '</ul>';
            content += '</div>'; // .labels
            content += '<div class="data narrow">';
            content += '<ul>';
            content += '<li>' + missingDate + '</li>';
            content += '<li>' + lastSeenAddress + '</li>';
            content += '<li>' + get(child, ['Age'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['Gender'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'PersonSkinToneCode'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'PersonHairColorCode'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'PersonEyeColorCode'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'Height'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'Weight'], '&nbsp;') + '</li>';
            content += '<li>' + get(child, ['PhysicalDescription', 'Description'], '&nbsp;') + '</li>';
            content += '</ul>';
            content += '</div>'; // .data
            content += '</div>'; // .bucket

            return content;
        }

        // remove existing alerts first
        $('.amberalert').remove();
        $('button.amberalerts').remove();

        var alerts = ABNET.jsonParse(localStorage.getItem('amberalerts'));

        if (!Array.isArray(alerts)) {
            alerts = [alerts];
        }

        if (Array.isArray(alerts[0])) {
            alerts = alerts[0];
        }

        if (!alerts || !alerts.length) {
            return '';
        }

        var mainPage = getPage('amberalert');

        var closeButton = $('<button class="menu-close"></button>').on('click', function() {
            $('#amberalert').addClass('hidden');
        });

        mainPage.addClass('amberalert').append(closeButton);

        if (alerts.length > 1) {
            alerts.forEach(function(alert, index) {
                var message = get(alert, ['fullmessage']);
                var child = get(message, ['MissingChild']);

                if (Array.isArray(child)) {
                    child = child[0];
                }

                var childName = get(child, ['PersonGivenName']) + ' ' + get(child, ['PersonSurName']);
                var childImage = get(child, ['PhysicalDescription', 'Picture', 'ExternalPicture', 'ImageUrl']);
                var bucketName = getAlertPageName('bucket', alert, index);
                var bucket = $('#' + bucketName);

                if (!bucket.length) {
                    bucket = $('<div id="' + bucketName + '" class="bucket clearfix">');

                    bucket.append('<p class="name">' + childName + '</p>');
                    bucket.append('<div class="photo"><img src="' + childImage + '" title="' + childName + '"></div>');

                    bucket.on('click', function() {
                        var pageName = getAlertPageName('#amberalert', alert, index);

                        $(pageName).removeClass('hidden');
                    });

                    mainPage.append(bucket);
                }
            });
        }

        alerts.forEach(function(alert, index) {
            // if there is only 1 alert, use the main alerts page to display it
            if (alerts.length === 1) {
                var page = getPage('amberalert');
            }
            else {
                var pageName = getAlertPageName('amberalert', alert, index);

                page = getPage(pageName);
            }

            var message = get(alert, ['fullmessage']);
            var info = get(message, ['IncidentInformation']);
            var child = get(message, ['MissingChild']);
            var suspect = get(message, ['Suspect', 'SuspectPerson']);
            var vehicle = get(message, ['Suspect', 'SuspectVehicle']);
            var suspectName = get(suspect, ['PersonGivenName']) + ' ' + get(suspect, ['PersonSurName']);
            var suspectImage = get(suspect, ['PhysicalDescription', 'Picture', 'ExternalPicture', 'ImageUrl']);
            var missingDate = get(info, ['MissingPersonLastSeenDate'], '&nbsp;');
            var lastSeenCity = get(info, ['LastSeenAddress', 'AddressCityName']);
            var lastSeenState = get(info, ['LastSeenAddress', 'AddressStateName']);
            var lastSeenAddress = '&nbsp;';
            var contactName = get(info, ['PointOfContact', 'ContactOrganizationName']);
            var contactNumber = get(info, ['PointOfContact', 'PhoneNumber', 'Number']);
            var contactInfo = '';

            if (missingDate !== '&nbsp;') {
                missingDate = moment(missingDate, 'YYYY-MM-DD').format('MMMM DD, YYYY');
            }

            if (lastSeenCity && lastSeenState) {
                lastSeenAddress = lastSeenCity + ', ' + lastSeenState;
            }

            if (contactName && contactNumber) {
                contactInfo = contactName + ' ' + contactNumber;
            }

            var closeButton = $('<button class="menu-close"></button>').on('click', function() {
                page.addClass('hidden');
            });

            var content = '<div class="amberalertswindow">';

            content += '<h1>MISSING</h1>';
            content += '<p class="header">HELP BRING ME HOME</p>';
            content += '<div class="content clearfix">';

            if (Array.isArray(child)) {
                var children = child;

                children.forEach(function(child) {
                    content += renderChild(child, missingDate, lastSeenAddress);
                });
            }
            else {
                content += renderChild(child, missingDate, lastSeenAddress);
            }

            content += '</div>'; // .content

            content += '<div class="desc clearfix">';
            content += '<p class="circumstance">' + get(info, ['MissingPersonCircumstanceText']) + '</p>';

            content += '<p class="bold">Associated Suspect</p>';
            content += '<div class="clearfix">';
            content += '<div class="child clearfix">';

            if (suspectImage) {
                content += '<div class="photo">';
                content += '<img src="' + suspectImage + '" title="' + suspectName + '">';
                content += '</div>'; // .photo
            }

            content += '<div class="data">';
            content += '<ul>';
            content += '<li><p class="name">' + suspectName + '</p></li>';
            content += '<li>Age: ' + get(suspect, ['Age']) + '</li>';
            content += '<li>Sex: ' + get(suspect, ['Gender']) + '</li>';
            content += '<li>Skin Tone: ' + get(suspect, ['PhysicalDescription', 'PersonSkinToneCode']) + '</li>';
            content += '<li>Hair Color: ' + get(suspect, ['PhysicalDescription', 'PersonHairColorCode']) + '</li>';
            content += '<li>Eye Color: ' + get(suspect, ['PhysicalDescription', 'PersonEyeColorCode']) + '</li>';
            content += '<li>Height: ' + get(suspect, ['PhysicalDescription', 'Height']) + '</li>';
            content += '<li>Weight: ' + get(suspect, ['PhysicalDescription', 'Weight']) + '</li>';
            content += '<li>Description: ' + get(suspect, ['PhysicalDescription', 'Description']) + '</li>';
            content += '</ul>';
            content += '<ul>';
            content += '<li><p class="name">&nbsp;</p></li>';
            content += '<li><p class="vehicle">Vehicle</li>';
            content += '<li>Year: ' + get(vehicle, ['VehicleModelYearText']) + '</li>';
            content += '<li>Make: ' + get(vehicle, ['VehicleMakeCode']) + '</li>';
            content += '<li>Model: ' + get(vehicle, ['VehicleModelCode']) + '</li>';
            content += '<li>Color: ' + get(vehicle, ['VehicleColorPrimaryCode']) + '</li>';
            content += '<li>License Plate State: ' + get(vehicle, ['LicensePlate', 'LicensePlateState']) + '</li>';
            content += '<li>Description: ' + get(vehicle, ['VehicleDescription']) + '</li>';
            content += '</ul>';
            content += '</div>'; // .data
            content += '</div>'; // .child
            content += '</div>'; // .clearfix
            content += '</div>'; // .desc

            content += '<div class="clearfix">';
            content += '<p class="bold">DON\'T HESITATE</p>';
            content += '<p class="contact">ANYONE HAVING INFORMATION SHOULD CONTACT</p>';
            content += '</div>';
            content += '<p class="footer"><span class="large">CALL 911 OR</span><br>';
            content += contactInfo;
            content += '</p>'; // .footer
            content += '</div>'; // #amberalertwindow

            page.addClass('amberalert').append(closeButton, content);
        });
    }

    function getNoticeHtml(pageName) {
        var notice = getNotice(pageName);
        var store;
        var content;

        switch (pageName) {
            case 'anniversary':
                content = getNoticeContent(1);

                if (Array.isArray(content) && content.length > 0) {
                    var alist = $('<ul>');
                    content.forEach(function(item) {
                        var listItem = $('<li>').text(item[1]);
                        alist.append(listItem);
                    });

                    notice.append(alist);
                }
                break;
            case 'birthday':
                content = getNoticeContent(2);

                if (Array.isArray(content) && content.length > 0) {
                    var blist = $('<ul>');
                    content.forEach(function(item) {
                        var listItem = $('<li>').text(item[1]);
                        blist.append(listItem);
                    });

                    notice.append(blist);
                }
                break;
            case 'sales':
                content = getNoticeContent(3);

                if (content) {
                    store = content[1] === undefined ? 'Store Unknown' : 'Store #' + content[1];
                    var weekly = content[4] === undefined ? '0' : content[4];
                    var yearly = content[3] === undefined ? '0' : content[3];

                    store = $('<div>').attr('id', 'mc3-storeno').addClass('absolute').text(store);
                    weekly = $('<div>').attr('id', 'mc3-week').addClass('absolute').text(weekly);
                    yearly = $('<div>').attr('id', 'mc3-year').addClass('absolute').text(yearly);

                    notice.append(store, weekly, yearly);
                }
                break;
            case 'ahod':
                content = getNoticeContent(3);

                if (content) {
                    store = content[1] === undefined ? 'Store Unknown' : 'Store #' + content[1];
                    var weekday = content[5] === undefined ? '0' : content[5];
                    var weekend = content[6] === undefined ? '0' : content[6];

                    store = $('<div>').attr('id', 'mc4-storeno').addClass('absolute').text(store);
                    weekday = $('<div>').attr('id', 'mc4-weekday').addClass('absolute').text(weekday);
                    weekend = $('<div>').attr('id', 'mc4-weekend').addClass('absolute').text(weekend);

                    notice.append(store, weekday, weekend);
                }
                break;
            case 'friendliness':
                content = getNoticeContent(3);

                if (content) {
                    store = content[1] === undefined ? 'Store Unknown' : 'Store #' + content[1];
                    var score = content[7] === undefined ? 0 : parseFloat(content[7]);
                    var bucket = 1;

                    if (score <= 69) {
                        bucket = 1;
                    }
                    else if (70 <= score && score <= 75) {
                        bucket = 2;
                    }
                    else if (76 <= score && score <= 79) {
                        bucket = 3;
                    }
                    else if (80 <= score && score <= 100) {
                        bucket = 4;
                    }

                    bucket = $('<div>').attr('id', 'bubble-' + bucket.toString()).addClass('absolute bubble');
                    store = $('<div>').addClass('bubble-store').text(store);
                    score = $('<div>').addClass('bubble-score').text(score);

                    bucket.append(store, score);
                    notice.append(bucket);
                }
                break;
            case 'extra':
                // NOTE: this is the extra page in the My Store section, normally for SFTK
                // NOTE: the content for this is parsed as:
                //  [
                //      store_number,
                //      [
                //          close_date,
                //          start_date,
                //          end_date,
                //          store_total, corp_total,
                //      store_1_number, store_1_total,
                //      store_2_number, store_2_total,
                //      store_3_number, store_3_total,
                //      store_4_number, store_4_total,
                //          store_5_number, store_5_total
                //      ]
                //  ]
                // The store_number and the three dates in the inner array are NOT used.
                content = getNoticeContent(4);

                // NOTE: use this for local testing, change "true" to "false" when done
                if (false) {
                    content = ['store', [
                        'close', 'start', 'end',
                        '8888', '22222',
                        '100', '11111',
                        '200', '9999',
                        '300', '8888',
                        '400', '7777',
                        '500', '6666'
                    ]];
                }

                var enableExtraPage = getExtras('page');

                if (enableExtraPage) {
                    try {
                        var c = content[1];
                        var html = '<div id="extra-store"><span>' + ABNET.currency(c[4]) + '</span></div>';

                        html += '<div id="extra-corp">' + ABNET.currency(c[5]) + '</div>';
                        html += '<div id="extra-1">#' + parseInt(c[6], 10) + ' - ' + ABNET.currency(c[7]) + '</div>';
                        html += '<div id="extra-2">#' + parseInt(c[8], 10) + ' - ' + ABNET.currency(c[9]) + '</div>';
                        html += '<div id="extra-3">#' + parseInt(c[10], 10) + ' - ' + ABNET.currency(c[11]) + '</div>';
                        html += '<div id="extra-4">#' + parseInt(c[12], 10) + ' - ' + ABNET.currency(c[13]) + '</div>';
                        html += '<div id="extra-5">#' + parseInt(c[14], 10) + ' - ' + ABNET.currency(c[15]) + '</div>';

                        notice.append(html);
                    }
                    catch (e) {
                        // don't console log error, we want to still render the page
                    }
                }
                else {
                    return '';
                }
                break;
            case 'messages':
                content = getMessages();

                // if no messages, leave this notice out of the my store section
                if (!content.length) {
                    notice = '';
                }
                else {
                    var messageList = $('<ul>');

                    content.forEach(function(message) {
                        var listItem = $('<li>').text(message.message);

                        messageList.append(listItem);
                    });

                    notice.append(messageList);

                    // clear the messages timer if there is one
                    if (ABCONST.TIMERS.messages.timer) {
                        clearTimeout(ABCONST.TIMERS.messages.timer);
                        ABCONST.TIMERS.messages.timer = null;
                        ABCONST.TIMERS.messages.timeout = 0;
                    }

                    var displayUntil = 0;
                    // loop through messages and find the latest displayUntil date
                    content.forEach(function(message) {
                        if (message.displayUntil) {
                            var date = moment(message.displayUntil, 'MM/DD/YYYY');

                            if (date.valueOf() > displayUntil) {
                                displayUntil = date.valueOf();
                            }
                        }
                    });

                    // if no display until found, default to 3 weeks
                    if (!displayUntil) {
                        displayUntil = moment().add(3, 'weeks').valueOf();
                    }

                    // calculate how long to show the messages
                    ABCONST.TIMERS.messages.timeout = displayUntil - moment().valueOf();

                    if (ABCONST.TIMERS.messages.timeout < 0) {
                        ABCONST.TIMERS.messages.timeout = 0;
                    }

                    // limit timeout to MAX_TIMEOUT
                    if (ABCONST.TIMERS.messages.timeout > ABCONST.TIMERS.messages.maxTimeout) {
                        ABCONST.TIMERS.messages.timeout = ABCONST.TIMERS.messages.maxTimeout;
                    }

                    // start message timer
                    ABCONST.TIMERS.messages.timer = setTimeout(function() {
                        // set timer to null
                        ABCONST.TIMERS.messages.timer = null;

                        // remove messages notice page
                        $('#notice-messages').remove();

                        // reindex notice pages
                        $('.notice').each(function(index, notice) {
                            $(notice).data('index', index);
                        });

                        // remove messages slide
                        $('#mystore-message').remove();
                        // reset slide show
                        slideShow(true);
                    }, ABCONST.TIMERS.messages.timeout);
                }
                break;
        }

        return notice;
    }

    function getNotice(name) {
        var index = $('.notice').length;

        return $('<div>')
            .attr('id', 'notice-' + name)
            .attr('data-index', index)
            .attr('data-page', name)
            .addClass('notice');
    }

    function getMessages() {
        var messages = ABNET.jsonParse(localStorage.getItem('messages'));

        if (!messages) {
            return [];
        }

        return messages;
    }

    function getNoticeContent(id) {
        var notice = localStorage.getItem('notice.' + id);

        if (notice === null) {
            return null;
        }

        try {
            notice = ABNET.jsonParse(notice);

            if (notice && notice.content) {
                return notice.content;
            }
        }
        catch (e) {
            return null;
        }
    }

    function setNoticeIndex(index) {
        index = index !== undefined ? index : 0;

        var count = $('.notice').length;

        if (index >= 0 && index < count) {
            $('.notice').removeClass('index');
            $('.notice').eq(index).addClass('index');
            $('.notices-nav button').removeClass('disabled').removeAttr('disabled');

            if (index === 0) {
                $('.notices-nav .prev').addClass('disabled').attr('disabled', 'disabled');
            }
            else if (index === count - 1) {
                $('.notices-nav .next').addClass('disabled').attr('disabled', 'disabled');
            }
        }
    }

    function noticesNavClick(e) {
        var buttonClicked = $(e.currentTarget);
        var currentNotice = $('.notice.index');
        var nextNotice = currentNotice.next();

        if (nextNotice.length === 0) {
            nextNotice = $('.notice').first();
        }

        if (buttonClicked.hasClass('prev')) {
            nextNotice = currentNotice.prev();
            if (nextNotice.length === 0) {
                nextNotice = $('.notice').last();
            }
        }

        gotoPage('notices-page', false, nextNotice.data('index'));
    }

    function noticesNav() {
        var nav = $('<div>').addClass('notices-nav');
        var prevButton = $('<button>').addClass('prev').attr('name', 'navigation-prev');
        var nextButton = $('<button>').addClass('next').attr('name', 'navigation-next');

        prevButton.on('click', noticesNavClick);
        nextButton.on('click', noticesNavClick);
        nav.append(prevButton).append(nextButton);

        return nav;
    }

    /**
     * INACTIVITY_TIMER starts on all pages except Home and Video.  It is reset (i.e. canceled and started)
     * on mouse moves and/or touches.  Renders the Home page on it expires (that's why it's not set on the Home page).
     * It is also not set on the Video page, so that a longer video can play to the end.  See VIDEO_END_TIMER
     * for video timers.
     */
    function startInactivityTimer() {
        ABCONST.TIMERS.inactivity.timer = setTimeout(function() {
            gotoPage('pages-content', true);
        }, ABCONST.TIMERS.inactivity.timeout);
    }

    function cancelInactivityTimer() {
        clearTimeout(ABCONST.TIMERS.inactivity.timer);
        ABCONST.TIMERS.inactivity.timer = null;
    }

    function resetInactivityTimer() {
        if (videoPlaying) {
            cancelInactivityTimer();
            return;
        }

        cancelInactivityTimer();
        startInactivityTimer();
    }

    function specialSheetzFest() {
        /**
         * Use for testing when there's no notice.5 in localStorage, just add
         * data = sfTest(a_number_between_0_and_8);
         * after
         * var data = JSON.parse(localStorage.getItem('notice.5'));
         *
         * Don't forget to remove it when done testing!
         *
         * A valid notice.5 object looks like:
         * { content: ['store_no', ['foo - 1 year'], ['bar - 2 years']] }
         *
         * @param {int} count Number of names to show, int between 0 and 8
         * @returns Valid notice.5 object
         */
        function sfTest(count) {
            var content = ['dev'];

            for (var i = 0; i < count; ++i) {
                var name = 'Name ' + (i + 1);
                var years = (i + 1) + ' ' + (i == 0 ? 'year' : 'years');

                content.push([name + ' - ' + years]);
            }

            return { content: content };
        }

        // remove existing special-sheetz-fest slide first
        $('#special-sheetz-fest').remove();

        var text = '<div id="special-sheetz-fest" class="slide outterslide" style="visibility:hidden;">';

        try {
            var data = JSON.parse(localStorage.getItem('notice.5'));

            // number of names to show
            var count = data.content.length - 1;

            // don't show if there are no names
            // { content: ['store_no'] }
            // { content: ['store_no', []] }
            // { content: ['store_no', ['']] }
            if (!count || !data.content[1].length || !data.content[1][0]) {
                return null;
            }

            var storeno = data.content[0].substring(0, 3);

            if (storeno === 'dev') {
                storeno = '123';
            }

            text += '<div id="storeno">' + storeno + '</div>';

            for (var i = 1; i < data.content.length; ++i) {
                var id = 'name-' + i + '-' + count;
                var split = data.content[i][0].split('-');

                if (split.length === 2) {
                    text += '<div id="' + id + '" class="name">';
                    text += '<div class="split-top">' + split[0].trim().toUpperCase() + '</div>';
                    text += '<div class="split-bottom">' + split[1].trim().toUpperCase() + '</div>';
                    text += '</div>';
                }
            }
        }
        catch (e) {
            // don't console log error, we want to still render the slide
        }

        text += '</div>';

        return text;
    }

    function myStoreMessageSlide() {
        // remove first to prevent duplicate slides
        $('#mystore-message').remove();

        var text = '<div id="mystore-message" class="slide outterslide" style="visibility:hidden;">';

        text += '<p>There are messages in the My Store section.</p>';

        text += '</div>';

        return text;
    }

    return {
        init: init
    };
})();

$(document).ready(APP.init);
