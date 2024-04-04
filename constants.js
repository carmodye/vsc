/*
 * Copyright 2011-2022 Abierto Networks, LLC.
 * All rights reserved.
 */

/* eslint-disable-next-line */
var ABCONST = (function () {
    var APP_ID = 10;

    /* Global */
    var TIMERS = {
        inactivity: {
            timer: null,
            timeout: 60 * 1000 // 1 minute
        },
        pageview: {
            timer: null,
            timeout: 3 * 1000 // 3 seconds
        },
        amberalert: {
            timer: null,
            timeout: 0,
            maxTimeout: 1814400000 // 21 days
        },
        messages: {
            timer: null,
            timeout: 0,
            maxTimeout: 1814400000 // 21 days
        }
    };

    /* Videos page */
    var VIDEO_COUNT = 5;
    var VIDEO_PER_ROW = 3;

    /* Video page */
    var VIDEO_END_TIMER;
    var VIDEO_END_TIMEOUT = 30 * 1000; // 30 seconds

    /* Notices page */
    var NOTICES = [
        'birthday',
        'anniversary',
        'messages',
        'extra',
        'sales',
        'ahod',
        'friendliness'
    ];

    var SPECIAL_SLIDE = true;

    var CATEGORIES = [
        { id: 1, name: 'Perks & Benefits' },
        { id: 2, name: 'Cigs & Tobacco' },
        { id: 3, name: 'Contests' },
        { id: 4, name: 'Food Service & Marketing' },
        { id: 5, name: 'Internal Comms' },
        { id: 6, name: 'Policies' },
        { id: 7, name: 'Procedures' },
        { id: 8, name: 'RISC' },
        { id: 9, name: 'Sheetz Accolades' },
        { id: 10, name: 'Recognition' },
        { id: 11, name: 'Strategic Messaging' },
        { id: 12, name: 'Employee Promo Awareness' }
    ];

    var QUESTIONS = [
        { id: 1, name: 'Question 1' },
        { id: 2, name: 'Question 2' },
        { id: 3, name: 'Question 3' }
    ];

    var LINKS = [
        { name: 'Link 1', link: 'https://ab-net.us' },
        { name: 'Link 2', link: 'https://ab-net.us' },
        { name: 'Link 3', link: 'https://ab-net.us' },
    ];

    var AMBERLABELS = [
        'Missing Since:',
        'Missing From:',
        'Age:',
        'Sex:',
        'Skin Tone:',
        'Hair Color:',
        'Eye Color:',
        'Height:',
        'Weight:',
        'Description:'
    ];

    return {
        APP_ID: APP_ID,
        TIMERS: TIMERS,
        VIDEO_COUNT: VIDEO_COUNT,
        VIDEO_PER_ROW: VIDEO_PER_ROW,
        VIDEO_END_TIMER: VIDEO_END_TIMER,
        VIDEO_END_TIMEOUT: VIDEO_END_TIMEOUT,
        NOTICES: NOTICES,
        SPECIAL_SLIDE: SPECIAL_SLIDE,
        CATEGORIES: CATEGORIES,
        QUESTIONS: QUESTIONS,
        LINKS: LINKS,
        AMBERLABELS: AMBERLABELS
    };

})();
