(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.D3HarChart = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

var defaultOptions, chartContainer, providers;

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
function D3HarChart (element, options) {
	
	EventEmitter.call(this);

	var defaultOptions = {

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

	var tooltip = d3.select(this.element).append('div')
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

	this.on('itemDeselected', function (element, data) {
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
D3HarChart.arrayToDomainRegex = function(domains) {
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
D3HarChart.prototype.zoomToElements = function(selection, filter, margin) {
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
		data, last, totalHeight, svg, div, bars, tooltip;

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
        .attr('height', function (d) {
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
D3HarChart.prototype.getRequestsFromHar = function(harData) {
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

},{"events":2,"inherits":3,"object-assign":4}],2:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],3:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],4:[function(require,module,exports){
/* eslint-disable no-unused-vars */
'use strict';
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

module.exports = Object.assign || function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (Object.getOwnPropertySymbols) {
			symbols = Object.getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}]},{},[1])(1)
});