'use strict';

var _ = require('lodash');
var extend = require('extend');
var sjcl = require('./utils').sjcl;
var utils = require('./utils');
var convertBase = require('./baseconverter');

var Base = {};

var alphabets = Base.alphabets = {
                                      // rrrrrrrrrrrrrrrrrrrrrrrrrrrr
  ripple: 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz',
  tipple: 'RPShNAF39wBUDnEGHJKLM4pQrsT7VWXYZ2bcdeCg65jkm8ofqi1tuvaxyz',
  bitcoin: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
};

extend(Base, {
  VER_NONE: 1,
  VER_NODE_PUBLIC: 28,
  VER_NODE_PRIVATE: 32,
  VER_ACCOUNT_ID: 0,
  VER_ACCOUNT_PUBLIC: 35,
  VER_ACCOUNT_PRIVATE: 34,
  VER_FAMILY_GENERATOR: 41,
  VER_FAMILY_SEED: 33,

  // 6 byte version to give `sEd` prefix to 16 byte seed encodings.
  // VER_ED25519_SEED: [ 73, 141, 118, 70, 140, 214]

  // 3 byte version to give `sEd` prefix to 16 byte seed encodings.
  VER_ED25519_SEED: [1, 225, 75]
});

function sha256(bytes) {
  return sjcl.codec.bytes.fromBits(
    sjcl.hash.sha256.hash(sjcl.codec.bytes.toBits(bytes)));
}

function encodeString(alphabet, input) {
  if (input.length === 0) {
    return '';
  }

  var leadingZeros = _.takeWhile(input, function(d) {
    return d === 0;
  });
  var out = convertBase(input, 256, 58).map(function(digit) {
    if (digit < 0 || digit >= alphabet.length) {
      throw new Error('Value ' + digit + ' is out of bounds for encoding');
    }
    return alphabet[digit];
  });
  var prefix = leadingZeros.map(function() {
    return alphabet[0];
  });
  return prefix.concat(out).join('');
}

function decodeString(indexes, input) {
  if (input.length === 0) {
    return [];
  }

  var input58 = input.split('').map(function(c) {
    var charCode = c.charCodeAt(0);
    if (charCode >= indexes.length || indexes[charCode] === -1) {
      throw new Error('Character ' + c + ' is not valid for encoding');
    }
    return indexes[charCode];
  });
  var leadingZeros = _.takeWhile(input58, function(d) {
    return d === 0;
  });
  var out = convertBase(input58, 58, 256);
  return leadingZeros.concat(out);
}

function Base58(alphabet) {
  var indexes = utils.arraySet(128, -1);
  for (var i = 0; i < alphabet.length; i++) {
    indexes[alphabet.charCodeAt(i)] = i;
  }
  return {
    decode: decodeString.bind(null, indexes),
    encode: encodeString.bind(null, alphabet)
  };
}

Base.encoders = {};
Object.keys(alphabets).forEach(function(alphabet) {
  Base.encoders[alphabet] = new Base58(alphabets[alphabet]);
});

// --> input: big-endian array of bytes.
// <-- string at least as long as input.
Base.encode = function(input, alpha) {
  return this.encoders[alpha || 'ripple'].encode(input);
};

// --> input: String
// <-- array of bytes or undefined.
Base.decode = function(input, alpha) {
  if (typeof input !== 'string') {
    return undefined;
  }
  try {
    return this.encoders[alpha || 'ripple'].decode(input);
  } catch (e) {
    return undefined;
  }
};

Base.verify_checksum = function(bytes) {
  var computed = sha256(sha256(bytes.slice(0, -4))).slice(0, 4);
  var checksum = bytes.slice(-4);
  return _.isEqual(computed, checksum);
};

/**
* @param {Number} payloadLength - number of bytes encoded not incl checksum
* @param {String} desiredPrefix - desired prefix when base58 encoded with
*                                 checksum
* @return {Array} version
*/
Base.find_prefix = function(payloadLength, desiredPrefix) {
  var totalLength = payloadLength + 4; // for checksum
  var chars = (Math.log(Math.pow(256, totalLength)) / Math.log(58));
  var requiredChars = Math.ceil(chars + 0.2);
  var padding = 'V';
  var template = desiredPrefix + new Array(requiredChars + 1).join(padding);
  var bytes = Base.decode(template);
  var version = bytes.slice(0, -totalLength);
  return version;
};

/**
* @param {String} encoded - base58 checksum encoded data string
* @param {Number} expectedLength - of decoded bytes minus checksum
* @param {String} [alphabet] - used to encode `encoded`
* @return {Object} -
*/
Base.decode_multi = function(encoded, expectedLength, alphabet) {
  var buffer = Base.decode(encoded, alphabet);

  if (!Base.verify_checksum(buffer)) {
    // TODO: throw Error ?
    return {version: null, bytes: null, error: true};
  }

  var withoutSum = buffer.slice(0, -4);
  var versionBytes = withoutSum.slice(0, -expectedLength);
  var decoded = withoutSum.slice(-expectedLength);

  return {version: versionBytes, bytes: decoded, error: false};
};

// --> input: Array
// <-- String
Base.encode_check = function(version, input, alphabet) {
  var buffer = [].concat(version, input);
  var check = sha256(sha256(buffer)).slice(0, 4);

  return Base.encode([].concat(buffer, check), alphabet);
};

// --> input : String
// <-- NaN || sjcl.bn
Base.decode_check = function(version, input, alphabet) {
  var buffer = Base.decode(input, alphabet);

  if (!buffer || buffer.length < 5) {
    return NaN;
  }

  function isNotVersion(v) {
    return v !== buffer[0];
  }

  // Single valid version
  if (typeof version === 'number' && isNotVersion(version)) {
    return NaN;
  }

  // Multiple allowed versions
  if (Array.isArray(version) && version.every(isNotVersion)) {
    return NaN;
  }

  if (!Base.verify_checksum(buffer)) {
    return NaN;
  }

  // We'll use the version byte to add a leading zero, this ensures JSBN doesn't
  // intrepret the value as a negative number
  // buffer[0] = 0;

  return sjcl.bn.fromBits(sjcl.codec.bytes.toBits(buffer.slice(1, -4)));
};

exports.Base = Base;
