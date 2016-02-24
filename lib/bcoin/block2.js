/**
 * block.js - block object for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * https://github.com/indutny/bcoin
 */

var bcoin = require('../bcoin');
var bn = require('bn.js');
var utils = bcoin.utils;
var assert = utils.assert;
var constants = bcoin.protocol.constants;
var network = bcoin.protocol.network;

/**
 * Block
 */

function Block(data) {
  var self = this;
  var tx, height;

  if (!(this instanceof Block))
    return new Block(data);

  bcoin.abstractblock.call(this, data);

  this.subtype = 'block';

  this.txs = data.txs || [];

  this._cbHeight = null;

  this.txs = this.txs.map(function(data) {
    if (data instanceof bcoin.tx)
      return data;

    return bcoin.tx(data, self);
  });

  if (!this._raw)
    this._raw = this.render();

  if (!this._size)
    this._size = this._raw.length;
}

utils.inherits(Block, bcoin.abstractblock);

Block.prototype.render = function render() {
  if (this._raw)
    return this._raw;
  return bcoin.protocol.framer.block(this);
};

Block.prototype.getMerkleRoot = function getMerkleRoot() {
  var hashes = [];
  var i, root;

  assert(this.subtype === 'block');

  for (i = 0; i < this.txs.length; i++)
    hashes.push(this.txs[i].hash());

  root = utils.getMerkleRoot(hashes);

  if (!root)
    return utils.toHex(constants.zeroHash);

  return utils.toHex(root);
};

Block.prototype._verify = function _verify() {
  var uniq = {};
  var i, tx, hash;

  if (!this.verifyHeaders())
    return false;

  // Size can't be bigger than MAX_BLOCK_SIZE
  if (this.txs.length > constants.block.maxSize
      || this.getSize() > constants.block.maxSize) {
    utils.debug('Block is too large: %s', this.rhash);
    return false;
  }

  // First TX must be a coinbase
  if (!this.txs.length || !this.txs[0].isCoinbase()) {
    utils.debug('Block has no coinbase: %s', this.rhash);
    return false;
  }

  // Test all txs
  for (i = 0; i < this.txs.length; i++) {
    tx = this.txs[i];

    // The rest of the txs must not be coinbases
    if (i > 0 && tx.isCoinbase()) {
      utils.debug('Block more than one coinbase: %s', this.rhash);
      return false;
    }

    // Check for duplicate txids
    hash = tx.hash('hex');
    if (uniq[hash]) {
      utils.debug('Block has duplicate txids: %s', this.rhash);
      return false;
    }
    uniq[hash] = true;
  }

  // Check merkle root
  if (this.getMerkleRoot() !== this.merkleRoot) {
    utils.debug('Block failed merkleroot test: %s', this.rhash);
    return false;
  }

  return true;
};

Block.prototype.getCoinbaseHeight = function getCoinbaseHeight() {
  var coinbase, s, height;

  if (this.version < 2)
    return -1;

  if (this._cbHeight != null)
    return this._cbHeight;

  coinbase = this.txs[0];

  if (!coinbase || coinbase.inputs.length === 0)
    return -1;

  s = coinbase.inputs[0].script;

  if (Buffer.isBuffer(s[0]))
    height = bcoin.script.num(s[0], true);
  else
    height = -1;

  this._cbHeight = height;

  return height;
};

Block.reward = function reward(height) {
  var halvings = height / network.halvingInterval | 0;
  var reward;

  if (height < 0)
    return new bn(0);

  if (halvings >= 64)
    return new bn(0);

  reward = new bn(50).mul(constants.coin);
  reward.iushrn(halvings);

  return reward;
};

Block.prototype._getReward = function _getReward() {
  var reward, base, fee, height;

  if (this._reward)
    return this._reward;

  base = Block.reward(this.height);

  if (this.height === -1) {
    return this._reward = {
      fee: new bn(0),
      reward: base,
      base: base
    };
  }

  reward = this.txs[0].outputs.reduce(function(total, output) {
    total.iadd(output.value);
    return total;
  }, new bn(0));

  fee = reward.sub(base);

  return this._reward = {
    fee: fee,
    reward: reward,
    base: base
  };
};

Block.prototype.getBaseReward = function getBaseReward() {
  return this._getReward().base;
};

Block.prototype.getReward = function getReward() {
  return this._getReward().reward;
};

Block.prototype.getFee = function getFee() {
  return this._getReward().fee;
};

Block.prototype.getCoinbase = function getCoinbase() {
  var tx;

  tx = this.txs[0];
  if (!tx || !tx.isCoinbase())
    return;

  return tx;
};

Block.prototype.inspect = function inspect() {
  var copy = bcoin.block(this);
  copy.__proto__ = null;
  delete copy._raw;
  delete copy._chain;
  copy.hash = this.hash('hex');
  copy.rhash = this.rhash;
  copy.reward = utils.btc(this.getReward());
  copy.fee = utils.btc(this.getFee());
  copy.date = new Date((copy.ts || 0) * 1000).toISOString();
  return copy;
};

Block.prototype.toJSON = function toJSON() {
  return {
    type: 'block',
    subtype: this.subtype,
    height: this.height,
    relayedBy: this.relayedBy,
    hash: utils.revHex(this.hash('hex')),
    version: this.version,
    prevBlock: utils.revHex(this.prevBlock),
    merkleRoot: utils.revHex(this.merkleRoot),
    ts: this.ts,
    bits: this.bits,
    nonce: this.nonce,
    totalTX: this.totalTX,
    txs: this.txs.map(function(tx) {
      return tx.toJSON();
    })
  };
};

Block._fromJSON = function _fromJSON(json) {
  json.prevBlock = utils.revHex(json.prevBlock);
  json.merkleRoot = utils.revHex(json.merkleRoot);
  json.txs = json.txs.map(function(tx) {
    return bcoin.tx._fromJSON(tx);
  });
  return json;
};

Block.fromJSON = function fromJSON(json) {
  return new Block(Block._fromJSON(json));
};

Block.prototype.toCompact = function toCompact() {
  return {
    type: 'block',
    subtype: this.subtype,
    hash: this.hash('hex'),
    prevBlock: this.prevBlock,
    ts: this.ts,
    height: this.height,
    relayedBy: this.relayedBy,
    block: utils.toHex(this.render())
  };
};

Block._fromCompact = function _fromCompact(json) {
  var raw, parser, data;

  assert.equal(json.type, 'block');

  raw = new Buffer(json.block, 'hex');

  parser = new bcoin.protocol.parser();

  data = parser.parseBlock(raw);

  data.height = json.height;
  data.relayedBy = json.relayedBy;

  return data;
};

Block.fromCompact = function fromCompact(json) {
  return new Block(Block._fromCompact(json));
};

Block.prototype.toRaw = function toRaw(enc) {
  var data;

  data = this.render();

  if (enc === 'hex')
    data = utils.toHex(data);

  return data;
};

Block._fromRaw = function _fromRaw(data, enc) {
  var parser = new bcoin.protocol.parser();

  if (enc === 'hex')
    data = new Buffer(data, 'hex');

  return parser.parseBlock(data);
};

Block.fromRaw = function fromRaw(data, enc) {
  return new Block(Block._fromRaw(data, enc, subtype), subtype);
};

/**
 * Expose
 */

module.exports = Block;