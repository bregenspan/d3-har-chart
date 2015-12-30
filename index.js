/**
 * D3 HAR Chart
 * Visualizes waterfall charts from HAR data
 */

/*jshint node:true*/
/*global d3, window*/

'use strict';

var EventEmitter = require('events').EventEmitter,
    inherits = require('inherits'),
    objectAssign = require('object-assign');

/**
 * Constructs a HAR chart
 * @param {Element} element - element to render inside
 * @param {Object} [options] - optional custom options
 * @param {Array} [options.firstPartyHosts] - hostnames to consider first-party
 * @param {Object} [options.providers] - object mapping camel-cased provider names to array of hostnames
 * @param {Object} [options.providerGroups] - object mapping group names to arrays of provider names
 * @param {Object} [options.fileTags] - object mapping custom tag names to predicate functions
 * @param {Number} [options.itemHeight=10] - number of SVG units to size vertical bar height
 * @param {Number} [options.itemMargin=2] - number of SVG units by which to vertically space out bars
 */
function D3HarChart(element, options) {
    var defaultOptions;

    EventEmitter.call(this);

    defaultOptions = {

        firstPartyHosts: [],

        providers: {
            adobeAudienceManager: ['demdex.net'],
            amazon: ['amazon-adsystem.com'],
            chartbeat: ['chartbeat.com', 'chartbeat.net'],
            comscore: ['scorecardresearch.com'],
            criteo: ['criteo.com'],
            ghostery: ['betrad.com'],
            google: ['googletagservices.com', 'googleadservices.com', 'googlesyndication.com', 'doubleclick.net', '2mdn.net'],
            googleAnalytics: ['google-analytics.com'],
            integral: ['adsafeprotected.com', 'iasds01.com'],
            krux: ['krxd.net', 'krux.com'],
            moat: ['moatads.com'],
            nielsen: ['imrworldwide.com'],
            quantcast: ['quantserve.com'],
            researchNow: ['researchnow.com'],
            skimlinks: ['skimresources.com']
        },

        providerGroups: {
            'ads': [
                'adobeAudienceManager',
                'amazon',
                'ghostery',
                'google',
                'integral',
                'moat',
                'researchNow',
                'skimlinks'
            ],
            'analytics': [
                'cheartbeat',
                'comscore',
                'googleAnalytics',
                'quantcast',
                'nielsen'
            ]
        },

        // Custom tags that should be added to files matching the specified regexes or filter functions
        fileTags: {
            scriptLoader: /require\.js/i,
            mainScript: /javascripts\-min\/layer\/.*\.js$/i,
            firstParty: function (item) {
                return Boolean(item.domain.match(this.firstPartyRegex));
            },
            stats: function (item) {
                return (item.domain.match(this.firstPartyRegex) && item.path.indexOf('/stats/') === 0);
            }
        },

        itemHeight: 10,  // item height, in SVG coordinate units
        itemMargin: 2   // margin between items, in SVG coordinate units
    };

    this.element = element;
    this.options = objectAssign({}, defaultOptions, options);
    this.firstPartyRegex = D3HarChart.arrayToDomainRegex(this.options.firstPartyHosts);

    this.addTooltip();
}
inherits(D3HarChart, EventEmitter);

D3HarChart.prototype.addTooltip = function () {
    var tooltip;

    function msToRoundedS(ms) {
        var seconds = ms / 1000;
        return (Math.round(seconds * 100) / 100) + 's';
    }

    // Get display-friendly string representing list of providers for entry
    function getProvidersDisplayName(providers) {
        return Object.keys(providers).filter(function (providerName) {
            return Boolean(providers[providerName]);
        }).map(function (providerName) {
            providerName = providerName.replace(/([a-z])([A-Z])/g, '$1 $2');
            return providerName.charAt(0).toUpperCase() + providerName.slice(1);
        }).join(' / ');
    }

    tooltip = d3.select(this.element).append('div')
        .style('opacity', 0)
        .attr('class', 'tooltip');

    this.on('itemSelected', function (element, data) {
        var provider =  getProvidersDisplayName(data.providers);
        element.classList.add('selected');
        tooltip
            .html('<p>' + data.url + '</p>' +
                  (provider ? '<p>Provider: ' + provider + '</p>' : '') +
                '<p>' +
                    'Start: ' + msToRoundedS(data.start) + ' / ' +
                    'End: ' + msToRoundedS(data.end) +
                    ' (' + msToRoundedS(data.duration) + ')' +
                '</p>'
            )
            .style('opacity', 1);
    });

    this.on('itemDeselected', function (element) {
        element.classList.remove('selected');
        tooltip
            .html('')
            .style('opacity', 0);
    });

};

/**
 * Given array of domains, return a regular expression for matching them.
 * @param {array[string]} domains
 * @returns {RegExp}
 */
D3HarChart.arrayToDomainRegex = function (domains) {
    return new RegExp('(' + domains.join('|').replace(/\./g, '\\.') + ')$');
};

/**
 * Given an array matching currently-displayed request data, zoom
 * our chart to the smallest bounding box of elements matching
 * the specified filter function.
 * @param {d3.Selection} selection - D3 element selection
 * @param {function} [filter] - function to use for filtering to elements
 *                             that should be zoomed.
 * @param {number} [margin] - optional margin to leave around the zoomed area (as value from 0-1)
 */
D3HarChart.prototype.zoomToElements = function (selection, filter, margin) {
    var data = selection.data(),
        config = this.options,
        filtered, filteredMax, max;

    margin = margin || 0;

    // If no filter specified, zoom out
    filter = filter || function () {
        return true;
    };

    // Store original index of each item (so we know its position when filtered)
    data.forEach(function (d, idx) {
        d.index = idx;
    });

    filtered = data.filter(filter);
    filteredMax = {};
    max = {};

    // FIXME: d3.scale could likely be used here...
    function getXCoordinate(d) {
        return d.end;
    }

    function getYCoordinate(d) {
        return d.index * (config.itemHeight + config.itemMargin);
    }

    filteredMax.x = Math.max.apply(null, filtered.map(getXCoordinate));
    filteredMax.y = Math.max.apply(null, filtered.map(getYCoordinate));

    max.x = Math.max.apply(null, data.map(getXCoordinate));
    max.y = Math.max.apply(null, data.map(getYCoordinate));

    // Add some margin to zoomed area
    if (filteredMax.x < max.x) {
        filteredMax.x = Math.min(filteredMax.x * (1 + margin), max.x);
    }
    if (filteredMax.y < max.y) {
        filteredMax.y = Math.min(filteredMax.y * (1 + margin), max.y);
    }

    window.document.getElementsByTagName('svg')[0].style.transform = '' +
        'scaleX(' + (max.x / filteredMax.x) + ') ' +
        'scaleY(' + (max.y / filteredMax.y) + ')';
    // still rather blurry for me in Chrome...
    //'scale3d(' + (max.x / filteredMax.x) + ', ' + (max.y / filteredMax.y) + ', 1.0)';
};


/**
 * Visualizes the specified HAR data
 * @param {Object} harObject - HAR data object
 */
D3HarChart.prototype.displayObject = function (harObject) {
    var config = this.options,
        instance = this,
        data, last, totalHeight, svg, bars;

    data = this.getRequestsFromHar(harObject);

    last = data[data.length - 1];
    totalHeight = (config.itemHeight + config.itemMargin) * data.length;

    svg = d3.select(this.element).append('svg')
        .attr('viewBox', '0 0 ' + last.end + ' ' + totalHeight)
        .attr('preserveAspectRatio', 'none');

    // Replace camel-cased state name with hyphenated lowercase classname
    function toClassName(state) {
        return state.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    }

    bars = svg.selectAll('rect')
        .data(data)
        .enter().append('rect')
        .attr('id', function (d, i) {
            return 'chartEntry' + i;
        })
        .attr('x', function (d) {
            return d.start;
        })
        .attr('y', function (d, i) {
            return i * (config.itemHeight + config.itemMargin);
        })
        .attr('width', function (d) {
            return d.duration;
        })
        .attr('height', function () {
            return config.itemHeight;
        })
        .attr('title', function (d) {
            return d.domain + d.path;
        })
        .each(function (d) {
            this.classList.add('filetype-' + d.type);

            Object.keys(d.tags).forEach(function (tagName) {
                if (d.tags[tagName]) {
                    this.classList.add('tag-' + toClassName(tagName));
                }
            }.bind(this));

            Object.keys(d.providers).forEach(function (providerName) {
                if (d.providers[providerName]) {
                    this.classList.add('provider-' + providerName);
                }
            }.bind(this));
        })
        .on('mouseover', function (d) {
            instance.emit('itemSelected', this, d);
        })
        .on('mouseout', function (d) {
            instance.emit('itemDeselected', this, d);
        });
};

/**
 * Given an object containing HAR data, return an array of objects representing individual requests,
 * augmented with useful info like request start and end times.
 * @param {object} harData
 * @returns {array[object]} - array of objects with fields:
 *  - {string} url - request URL, abbreviated for display purposes
 *  - {string} domain - request domain, abbreviated for display purposes
 *  - {string} path - request path
 *  - {number} duration - request duration (ms)
 *  - {number} start - request start time (ms)
 *  - {number} end - request end time (ms)
 */
D3HarChart.prototype.getRequestsFromHar = function (harData) {
    var config = this.options,
        instance = this,
        harLog = harData.log,
        startDate = new Date(harLog.pages[0].startedDateTime),
        onLoad = harLog.pages[0].pageTimings.onLoad,
        items = [];

    // No support for multi-page HAR files at moment -- filter entries to first page
    if (harLog.pages.length > 1) {
        harLog.entries = harLog.entries.filter(function (entry) {
            return entry.pageref === harLog.pages[0].id;
        });
    }

    function urlAbbreviate(url) {
        url = url.replace(/^https?:\/\/(www\.)?/i, '');  // remove leading protocol/www
        url = url.replace(/\?.*/g, '');  // remove querystring
        url = url.replace(/#.*/g, '');  // remove fragment identifier
        return url;
    }

    function mimeToFiletype(mimeType) {
        if (mimeType.indexOf('image') > -1) {
            return 'image';
        } else if (mimeType.indexOf('script') > -1) {
            return 'script';
        } else if (mimeType.indexOf('css') > -1) {
            return 'style';
        } else if (mimeType.indexOf('font') > -1) {
            return 'font';
        } else {
            return 'other';
        }
    }

    /**
     * Given a timeline entry object, return object whose keys represent identified filename-based tags,
     * with `true` as the value for all identified tags.
     */
    function getFileTags(entry) {
        var tags = {};

        function getMatchFunction(regex) {
            return function (entry) {
                return Boolean(entry.url.match(regex));
            };
        }

        Object.keys(config.fileTags).forEach(function (tagName) {
            var filter = config.fileTags[tagName];
            if (typeof filter !== 'function') {  // assume regex
                filter = getMatchFunction(filter);
            }
            tags[tagName] = Boolean(filter.call(instance, entry));
        });

        return tags;
    }

    function getProviders(entry) {
        var providers = {};
        Object.keys(config.providers).forEach(function (providerName) {
            var providerRegex = D3HarChart.arrayToDomainRegex(config.providers[providerName]);
            if (entry.domain.match(providerRegex)) {
                providers[providerName] = true;
            }
        });
        return providers;
    }

    items = harLog.entries.map(function (entry) {
        var startTimeMs = new Date(entry.startedDateTime) - startDate,
            url = urlAbbreviate(entry.request.url);

        return {
            type: mimeToFiletype(entry.response.content.mimeType || ''),
            originalUrl: entry.request.url,
            url: url,
            domain: url.substring(0, url.indexOf('/')),
            path: url.substring(url.indexOf('/')),
            start: startTimeMs,
            duration: entry.time,
            end: Math.round(startTimeMs + entry.time)
        };
    });

    // Add configurable tags to each file
    items.forEach(function (item) {
        item.tags = getFileTags(item);
        item.providers = getProviders(item);
    });

    // Ignore requests which arrived after onload event
    items = items.filter(function (item) {
        return (item.start <= onLoad);
    });

    return items;
};

/**
 * Visualizes the HAR data from the specified path
 * @param {String} harPath - path to HAR file
 */
D3HarChart.prototype.displayFile = function (harPath) {
    d3.json(harPath, function (error, data) {
        if (data) {
            this.displayObject(data);
        }
    }.bind(this));
};

module.exports = D3HarChart;
