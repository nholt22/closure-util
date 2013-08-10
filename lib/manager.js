var EventEmitter = require('events').EventEmitter;
var path = require('path');
var util = require('util');

var async = require('async');

var globs = require('./util').globs;
var scripts = require('./scripts');


/**
 * Script manager.
 * @param {Object} Manager options.
 * @constructor
 * @extends {EventEmitter}
 */
var Manager = exports.Manager = function Manager(options) {
  EventEmitter.call(this);
  options = options || {};

  /**
   * Cache of managed scripts.
   * @type {Object.<string, Script}
   * @private
   */
  this.scripts_ = {};

  /**
   * Cache of the sorted dependencies.
   * @type {Array.<Script>}
   * @private
   */
  this.dependencies_ = null;

  var lib = options.lib || [];
  if (!Array.isArray(lib)) {
    lib = [lib];
  }

  /**
   * Lib glob patterns.
   * @type {Array.<string>}
   */
  this.lib_ = lib;

  /**
   * Absolute path to main script (if any).
   */
  this.main_ = options.main && path.resolve(options.main);
  if (this.main_) {
    this.lib_.push(this.main_);
  }

  var self = this;
  process.nextTick(function() {
    self.processLib_();
  });

};
util.inherits(Manager, EventEmitter);


/**
 * Add a script to the manager.
 * @param {Script} script Script to add.
 */
Manager.prototype.addScript_ = function(script) {
  var name = script.name;
  if (this.scripts_.hasOwnProperty(name)) {
    throw new Error('Script with same name already added: ' + name);
  }
  this.scripts_[name] = script;
  this.dependencies_ = null;
};


/**
 * Get a list of scripts sorted in dependency order.
 * @return {Array.<script>} List of scripts.
 */
Manager.prototype.getDependencies = function() {
  if (!this.dependencies_) {
    var scripts = this.scripts_;
    var providesLookup = {};
    Object.keys(scripts).forEach(function(name) {
      var script = scripts[name];
      script.provides.forEach(function(provide) {
        if (providesLookup.hasOwnProperty(provide)) {
          throw new Error('Redundant provide "' + provide + '" ' +
              'in script: ' + name + ' - already provided by ' +
              providesLookup[provide].name);
        }
        providesLookup[provide] = script;
      });
    });

    var visited = {};
    var dependencies = [];
    var visit = function(script) {
      if (!visited.hasOwnProperty(script.name)) {
        visited[script.name] = true;
        script.requires.forEach(function(require) {
          if (!providesLookup.hasOwnProperty(require)) {
            throw new Error('Unsatisfied dependency "' + require + '" ' +
              'in script: ' + script.name);
          }
          visit(providesLookup[require]);
        });
        dependencies.push(script);
      }
    };

    if (this.main_) {
      visit(scripts[this.main_]);
    } else {
      Object.keys(scripts).forEach(function(name) {
        visit(scripts[name]);
      });
    }
    this.dependencies_ = dependencies;
  }
  return this.dependencies_;
};


/**
 * Add all scripts based on configured lib.
 */
Manager.prototype.processLib_ = function() {
  var self = this;
  async.waterfall([
    function(callback) {
      globs(self.lib_, callback);
    },
    function(paths, callback) {
      async.map(paths, scripts.read, callback);
    },
    function(results, callback) {
      var err;
      try {
        results.forEach(self.addScript_, self);
      } catch (e) {
        err = e;
      }
      callback(err);
    }
  ], function(err) {
    if (err) {
      self.emit('error', err);
    } else {
      self.emit('ready');
    }
  });
};