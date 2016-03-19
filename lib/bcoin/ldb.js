/**
 * ldb.js - global ldb tracker
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * https://github.com/indutny/bcoin
 */

var EventEmitter = require('events').EventEmitter;
var bcoin = require('../bcoin');
var utils = bcoin.utils;
var network = bcoin.protocol.network;
var db = {};

module.exports = function ldb(name, options) {
  var file = bcoin.prefix + '/' + name + '-' + network.type + '.db';
  var backend = process.env.BCOIN_DB;
  var promise;

  bcoin.ensurePrefix();

  if (!options)
    options = {};

  if (!db[file]) {
    if (bcoin.isBrowser) {
      backend = require('level-js');
    } else {
      if (!backend || backend === 'rocksdb')
        backend = 'rocksdown';
      else if (backend === 'leveldb')
        backend = 'leveldown';
      else if (backend === 'lmdb')
        backend = 'lmdb';

      backend = require(backend);
    }

    db[file] = new LowlevelUp(file, {
      keyEncoding: 'ascii',
      valueEncoding: 'binary',

      // LevelDB and others
      createIfMissing: true,
      errorIfExists: false,
      compression: options.compression !== false,
      cacheSize: options.cacheSize || (8 << 20),
      writeBufferSize: options.writeBufferSize || (4 << 20),
      maxOpenFiles: options.maxOpenFiles || 8192,

      // For LMDB if we decide to use it:
      sync: options.sync || false,
      mapSize: options.mapSize || 150 * (1024 << 20),
      writeMap: options.writeMap || false,

      // For RocksDB
      memtableBudget: 512 << 20,

      db: backend
    });
  }

  return db[file];
};

/**
 * LowlevelUp
 *
 * Extremely low-level version of levelup.
 * The only levelup feature it provides is
 * error-wrapping. It gives a nice recallable
 * `open()` method and event. It assumes ascii
 * keys and binary values.
 *
 * This avoids pulling in extra deps and
 * lowers memory usage.
 */

function LowlevelUp(file, options) {
  var self = this;

  if (!(this instanceof LowlevelUp))
    return new LowlevelUp(file, options);

  EventEmitter.call(this);

  this.loaded = false;

  this.db = new options.db(file);

  // Stay as close to the metal as possible.
  // We want to make calls to C++ directly.
  if (this.db.db && this.db.db.put) {
    this.db = this.db.db;
    if (this.db.db && this.db.db.put)
      this.db = this.db.db;
  }

  this.db.open(options, function(err) {
    if (err)
      return self.emit('error', err);

    self.loaded = true;
    self.emit('open');
  });
}

utils.inherits(LowlevelUp, EventEmitter);

LowlevelUp.prototype.open = function open(callback) {
  if (this.loaded)
    return utils.nextTick(callback);

  this.once('open', callback);
};

LowlevelUp.prototype.get = function get(key, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  return this.db.get(key, options, function(err, result) {
    if (err) {
      if (err.notFound || /not\s*found/i.test(err.message)) {
        err.notFound = true;
        err.type = 'NotFoundError';
      }
      return callback(err);
    }
    return callback(null, result);
  });
};

LowlevelUp.prototype.close = function close(callback) {
  return this.db.close(callback);
};

LowlevelUp.prototype.put = function put(key, value, options, callback) {
  return this.db.put(key, value, options, callback);
};

LowlevelUp.prototype.del = function del(key, options, callback) {
  return this.db.del(key, options, callback);
};

LowlevelUp.prototype.batch = function batch(ops, options, callback) {
  if (!ops)
    return this.db.batch();
  return this.db.batch(ops, options, callback);
};

LowlevelUp.prototype.iterator = function iterator(options) {
  return this.db.iterator(options);
};

LowlevelUp.prototype.getProperty = function getProperty(name) {
  if (!this.db.getProperty)
    return null;

  return this.db.getProperty(name);
};

LowlevelUp.prototype.approximateSize = function approximateSize(start, end, callback) {
  return this.db.approximateSize(start, end, callback);
};