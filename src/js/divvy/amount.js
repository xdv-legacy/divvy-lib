'use strict';

// Represent Divvy amounts and currencies.
// - Numbers in hex are big-endian.

var assert = require('assert');
var extend = require('extend');
var utils = require('./utils');
var UInt160 = require('./uint160').UInt160;
var Seed = require('./seed').Seed;
var Currency = require('./currency').Currency;
var GlobalBigNumber = require('bignumber.js');

var BigNumber = GlobalBigNumber.another({
  ROUNDING_MODE: GlobalBigNumber.ROUND_HALF_UP,
  DECIMAL_PLACES: 40
});


function inverse(number) {
  return (new BigNumber(number)).toPower(-1);
}

function Amount() {
  // Json format:
  //  integer : XDV
  //  { 'value' : ..., 'currency' : ..., 'issuer' : ...}

  this._value = new BigNumber(NaN);
  this._is_native = true; // Default to XDV. Only valid if value is not NaN.
  this._currency = new Currency();
  this._issuer = new UInt160();
}

/**
 * Set strict_mode = false to disable amount range checking
 */

Amount.strict_mode = true;

var consts = {
  currency_xns: 0,
  currency_one: 1,
  xns_precision: 6,

  // bi_ prefix refers to "big integer"
  // TODO: we shouldn't expose our BigNumber library publicly
  bi_5: new BigNumber(5),
  bi_7: new BigNumber(7),
  bi_10: new BigNumber(10),
  bi_1e14: new BigNumber(1e14),
  bi_1e16: new BigNumber(1e16),
  bi_1e17: new BigNumber(1e17),
  bi_1e32: new BigNumber(1e32),
  bi_man_max_value: new BigNumber('9999999999999999'),
  bi_man_min_value: new BigNumber(1e15),
  bi_xns_max: new BigNumber(1e17),
  bi_xns_min: new BigNumber(-1e17),
  bi_xns_unit: new BigNumber(1e6),

  cMinOffset: -96,
  cMaxOffset: 80,

  // Maximum possible amount for non-XDV currencies using the maximum mantissa
  // with maximum exponent. Corresponds to hex 0xEC6386F26FC0FFFF.
  max_value: '9999999999999999e80',
  // Minimum possible amount for non-XDV currencies.
  min_value: '-1000000000000000e-96'
};

var MAX_XDV_VALUE = new BigNumber(1e11);
var MAX_IOU_VALUE = new BigNumber(consts.max_value);
var MIN_IOU_VALUE = (new BigNumber(consts.min_value)).abs();

// Add constants to Amount class
extend(Amount, consts);

// DEPRECATED: Use Amount instead, e.g. Amount.currency_xns
exports.consts = consts;

// Given '100/USD/ISSUER' return the a string with ISSUER remapped.
Amount.text_full_rewrite = function(j) {
  return Amount.from_json(j).to_text_full();
};

// Given '100/USD/ISSUER' return the json.
Amount.json_rewrite = function(j) {
  return Amount.from_json(j).to_json();
};

Amount.from_number = function(n) {
  return (new Amount()).parse_number(n);
};

Amount.from_json = function(j) {
  return (new Amount()).parse_json(j);
};

Amount.from_quality = function(quality, currency, issuer, opts) {
  return (new Amount()).parse_quality(quality, currency, issuer, opts);
};

Amount.from_human = function(j, opts) {
  return (new Amount()).parse_human(j, opts);
};

Amount.is_valid = function(j) {
  return Amount.from_json(j).is_valid();
};

Amount.is_valid_full = function(j) {
  return Amount.from_json(j).is_valid_full();
};

Amount.NaN = function() {
  var result = new Amount();
  result._value = new BigNumber(NaN); // should have no effect
  return result;                      // but let's be careful
};

// be sure that _is_native is set properly BEFORE calling _set_value
Amount.prototype._set_value = function(value, roundingMode) {
  assert(value instanceof BigNumber);
  this._value = value.isZero() && value.isNegative() ? value.negated() : value;
  this.canonicalize(roundingMode);
  this._check_limits();
};

// Returns a new value which is the absolute value of this.
Amount.prototype.abs = function() {
  return this.clone(this.is_negative());
};

Amount.prototype.add = function(addend) {
  var addendAmount = Amount.from_json(addend);

  if (!this.is_comparable(addendAmount)) {
    return new Amount(NaN);
  }

  return this._copy(this._value.plus(addendAmount._value));
};

Amount.prototype.subtract = function(subtrahend) {
  // Correctness over speed, less code has less bugs, reuse add code.
  return this.add(Amount.from_json(subtrahend).negate());
};

// XXX Diverges from cpp.
Amount.prototype.multiply = function(multiplicand) {
  var multiplicandAmount = Amount.from_json(multiplicand);
  // TODO: probably should just multiply by multiplicandAmount._value
  var multiplyBy = multiplicandAmount.is_native() ?
    multiplicandAmount._value.times(Amount.bi_xns_unit)
    : multiplicandAmount._value;
  return this._copy(this._value.times(multiplyBy));
};

Amount.prototype.scale = function(scaleFactor) {
  return this._copy(this._value.times(scaleFactor));
};

Amount.prototype.divide = function(divisor) {
  var divisorAmount = Amount.from_json(divisor);
  if (!this.is_valid()) {
    throw new Error('Invalid dividend');
  }
  if (!divisorAmount.is_valid()) {
    throw new Error('Invalid divisor');
  }
  if (divisorAmount.is_zero()) {
    throw new Error('divide by zero');
  }
  // TODO: probably should just divide by divisorAmount._value
  var divideBy = divisorAmount.is_native() ?
    divisorAmount._value.times(Amount.bi_xns_unit)
    : divisorAmount._value;
  return this._copy(this._value.dividedBy(divideBy));
};

/**
 * This function calculates a ratio - such as a price - between two Amount
 * objects.
 *
 * The return value will have the same type (currency) as the numerator. This is
 * a simplification, which should be sane in most cases. For example, a USD/XDV
 * price would be rendered as USD.
 *
 * @example
 *   var price = buy_amount.ratio_human(sell_amount);
 *
 * @this {Amount} The numerator (top half) of the fraction.
 * @param {Amount} denominator The denominator (bottom half) of the fraction.
 * @param opts Options for the calculation.
 * @param opts.reference_date {Date|Number} Date based on which
 * demurrage/interest should be applied. Can be given as JavaScript Date or int
 * for Divvy epoch.
 * @return {Amount} The resulting ratio. Unit will be the same as numerator.
 */

Amount.prototype.ratio_human = function(denominator, opts) {
  opts = extend({ }, opts);

  var numerator = this.clone();

  denominator = Amount.from_json(denominator);

  // If either operand is NaN, the result is NaN.
  if (!numerator.is_valid() || !denominator.is_valid()) {
    return new Amount(NaN);
  }

  if (denominator.is_zero()) {
    return new Amount(NaN);
  }

  // Apply interest/demurrage
  //
  // We only need to apply it to the second factor, because the currency unit of
  // the first factor will carry over into the result.
  if (opts.reference_date) {
    denominator = denominator.applyInterest(opts.reference_date);
  }

  // Special case: The denominator is a native (XDV) amount.
  //
  // In that case, it's going to be expressed as base units (1 XDV =
  // 10^xns_precision base units).
  //
  // However, the unit of the denominator is lost, so when the resulting ratio
  // is printed, the ratio is going to be too small by a factor of
  // 10^xns_precision.
  //
  // To compensate, we multiply the numerator by 10^xns_precision.
  if (denominator._is_native) {
    numerator._set_value(numerator._value.times(Amount.bi_xns_unit));
  }

  return numerator.divide(denominator);
};

/**
 * Calculate a product of two amounts.
 *
 * This function allows you to calculate a product between two amounts which
 * retains XDVs human/external interpretation (i.e. 1 XDV = 1,000,000 base
 * units).
 *
 * Intended use is to calculate something like: 10 USD * 10 XDV/USD = 100 XDV
 *
 * @example
 *   var sell_amount = buy_amount.product_human(price);
 *
 * @see Amount#ratio_human
 *
 * @param {Amount} factor The second factor of the product.
 * @param {Object} opts Options for the calculation.
 * @param {Date|Number} opts.reference_date Date based on which
 * demurrage/interest should be applied. Can be given as JavaScript Date or int
 * for Divvy epoch.
 * @return {Amount} The product. Unit will be the same as the first factor.
 */
Amount.prototype.product_human = function(factor, opts) {
  opts = opts || {};

  factor = Amount.from_json(factor);

  // If either operand is NaN, the result is NaN.
  if (!this.is_valid() || !factor.is_valid()) {
    return new Amount(NaN);
  }

  // Apply interest/demurrage
  //
  // We only need to apply it to the second factor, because the currency unit of
  // the first factor will carry over into the result.
  if (opts.reference_date) {
    factor = factor.applyInterest(opts.reference_date);
  }

  var product = this.multiply(factor);

  // Special case: The second factor is a native (XDV) amount expressed as base
  // units (1 XDV = 10^xns_precision base units).
  //
  // See also Amount#ratio_human.
  if (factor._is_native) {
    product._set_value(product._value.dividedBy(Amount.bi_xns_unit));
  }

  return product;
};

/**
 * Turn this amount into its inverse.
 *
 * @return {Amount} self
 * @private
 */
Amount.prototype._invert = function() {
  this._set_value(inverse(this._value));
  return this;
};

/**
 * Return the inverse of this amount.
 *
 * @return {Amount} New Amount object with same currency and issuer, but the
 *   inverse of the value.
 */
Amount.prototype.invert = function() {
  return this.clone()._invert();
};

/**
 * Canonicalize amount value
 *
 * Mirrors divvyd's internal Amount representation
 * From https://github.com/xdv/divvyd/blob/develop/src/divvy/data
 * /protocol/STAmount.h#L31-L40
 *
 * Internal form:
 * 1: If amount is zero, then value is zero and offset is -100
 * 2: Otherwise:
 *    legal offset range is -96 to +80 inclusive
 *    value range is 10^15 to (10^16 - 1) inclusive
 *    amount = value * [10 ^ offset]
 *
 * -------------------
 *
 * The amount can be epxresses as A x 10^B
 * Where:
 * - A must be an integer between 10^15 and (10^16)-1 inclusive
 * - B must be between -96 and 80 inclusive
 *
 * This results
 * - minumum: 10^15 x 10^-96 -> 10^-81 -> -1e-81
 * - maximum: (10^16)-1 x 10^80 -> 9999999999999999e80
 *
 * @returns {Amount}
 * @throws {Error} if offset exceeds legal ranges, meaning the amount value is
 * bigger than supported
 */

Amount.prototype.canonicalize = function(roundingMode) {
  if (this._is_native) {
    this._value = this._value.round(6, BigNumber.ROUND_DOWN);
  } else if (roundingMode) {
    this._value = new BigNumber(this._value.toPrecision(16, roundingMode));
  } else {
    this._value = new BigNumber(this._value.toPrecision(16));
  }
};

Amount.prototype._check_limits = function() {
  if (!Amount.strict_mode) {
    return this;
  }
  if (this._value.isNaN() || this._value.isZero()) {
    return this;
  }
  var absval = this._value.absoluteValue();
  if (this._is_native) {
    if (absval.greaterThan(MAX_XDV_VALUE)) {
      throw new Error('Exceeding max value of ' + MAX_XDV_VALUE.toString());
    }
  } else {
    if (absval.lessThan(MIN_IOU_VALUE)) {
      throw new Error('Exceeding min value of ' + MIN_IOU_VALUE.toString());
    }
    if (absval.greaterThan(MAX_IOU_VALUE)) {
      throw new Error('Exceeding max value of ' + MAX_IOU_VALUE.toString());
    }
  }
  return this;
};

Amount.prototype.clone = function(negate) {
  return this.copyTo(new Amount(), negate);
};

Amount.prototype._copy = function(value) {
  var copy = this.clone();
  copy._set_value(value);
  return copy;
};

Amount.prototype.compareTo = function(to) {
  var toAmount = Amount.from_json(to);
  if (!this.is_comparable(toAmount)) {
    return new Amount(NaN);
  }
  return this._value.comparedTo(toAmount._value);
};

// Make d a copy of this. Returns d.
// Modification of objects internally refered to is not allowed.
Amount.prototype.copyTo = function(d, negate) {
  d._value = negate ? this._value.negated() : this._value;
  d._is_native = this._is_native;
  d._currency = this._currency;
  d._issuer = this._issuer;
  return d;
};

Amount.prototype.currency = function() {
  return this._currency;
};

Amount.prototype.equals = function(d, ignore_issuer) {
  if (!(d instanceof Amount)) {
    return this.equals(Amount.from_json(d));
  }

  return this.is_valid() && d.is_valid()
         && this._is_native === d._is_native
         && this._value.equals(d._value)
         && (this._is_native || (this._currency.equals(d._currency)
              && (ignore_issuer || this._issuer.equals(d._issuer))));
};

// True if Amounts are valid and both native or non-native.
Amount.prototype.is_comparable = function(v) {
  return this.is_valid() && v.is_valid() && this._is_native === v._is_native;
};

Amount.prototype.is_native = function() {
  return this._is_native;
};

Amount.prototype.is_negative = function() {
  return this._value.isNegative();
};

Amount.prototype.is_positive = function() {
  return !this.is_zero() && !this.is_negative();
};

// Only checks the value. Not the currency and issuer.
Amount.prototype.is_valid = function() {
  return !this._value.isNaN();
};

Amount.prototype.is_valid_full = function() {
  return this.is_valid()
  && this._currency.is_valid()
  && this._issuer.is_valid();
};

Amount.prototype.is_zero = function() {
  return this._value.isZero();
};

Amount.prototype.issuer = function() {
  return this._issuer;
};

// Return a new value.
Amount.prototype.negate = function() {
  return this.clone('NEGATE');
};

/**
 * Tries to correctly interpret an amount as entered by a user.
 *
 * Examples:
 *
 *   XDV 250     => 250000000/XDV
 *   25.2 XDV    => 25200000/XDV
 *   USD 100.40  => 100.4/USD/?
 *   100         => 100000000/XDV
 *
 *
 * The regular expression below matches above cases, broken down for better
 * understanding:
 *
 * // either 3 letter alphabetic currency-code or 3 digit numeric currency-code.
 * // See ISO 4217
 * ([A-z]{3}|[0-9]{3})
 *
 * // end of string
 * $
 */

Amount.prototype.parse_human = function(j, opts) {
  opts = opts || {};

  var hex_RE = /^[a-fA-F0-9]{40}$/;
  var currency_RE = /^([a-zA-Z]{3}|[0-9]{3})$/;

  var value;
  var currency;

  var words = j.split(' ').filter(function(word) {
    return word !== '';
  });

  function isNumber(s) {
    return isFinite(s) && s !== '' && s !== null;
  }

  if (words.length === 1) {
    if (isNumber(words[0])) {
      value = words[0];
      currency = 'XDV';
    } else {
      value = words[0].slice(0, -3);
      currency = words[0].slice(-3);
      if (!(isNumber(value) && currency.match(currency_RE))) {
        return new Amount(NaN);
      }
    }
  } else if (words.length === 2) {
    if (isNumber(words[0]) && words[1].match(hex_RE)) {
      value = words[0];
      currency = words[1];
    } else if (words[0].match(currency_RE) && isNumber(words[1])) {
      value = words[1];
      currency = words[0];
    } else if (isNumber(words[0]) && words[1].match(currency_RE)) {
      value = words[0];
      currency = words[1];
    } else {
      return new Amount(NaN);
    }
  } else {
    return new Amount(NaN);
  }

  currency = currency.toUpperCase();
  this.set_currency(currency);
  this._is_native = (currency === 'XDV');
  this._set_value(new BigNumber(value));

  // Apply interest/demurrage
  if (opts.reference_date && this._currency.has_interest()) {
    var interest = this._currency.get_interest_at(opts.reference_date);
    this._set_value(this._value.dividedBy(interest.toString()));
  }

  return this;
};

Amount.prototype.parse_issuer = function(issuer) {
  this._issuer = UInt160.from_json(issuer);
  return this;
};

/**
 * Decode a price from a BookDirectory index.
 *
 * BookDirectory ledger entries each encode the offer price in their index. This
 * method can decode that information and populate an Amount object with it.
 *
 * It is possible not to provide a currency or issuer, but be aware that Amount
 * objects behave differently based on the currency, so you may get incorrect
 * results.
 *
 * Prices involving demurraging currencies are tricky, since they depend on the
 * base and counter currencies.
 *
 * @param {String} quality 8 hex bytes quality or 32 hex bytes BookDirectory
 *   index.
 * @param {Currency|String} counterCurrency currency of the resulting Amount
 *   object.
 * @param {Issuer|String} counterIssuer Issuer of the resulting Amount object.
 * @param {Object} opts Additional options
 * @param {Boolean} opts.inverse If true, return the inverse of the price
 *   encoded in the quality.
 * @param {Currency|String} opts.base_currency The other currency. This plays a
 *   role with interest-bearing or demurrage currencies. In that case the
 *   demurrage has to be applied when the quality is decoded, otherwise the
 *   price will be false.
 * @param {Date|Number} opts.reference_date Date based on which
 * demurrage/interest should be applied. Can be given as JavaScript Date or int
 * for Divvy epoch.
 * @param {Boolean} opts.xdv_as_drops Whether XDV amount should be treated as
 *   drops. When the base currency is XDV, the quality is calculated in drops.
 *   For human use however, we want to think of 1000000 drops as 1 XDV and
 *   prices as per-XDV instead of per-drop.
 * @return {Amount} self
 */
Amount.prototype.parse_quality =
function(quality, counterCurrency, counterIssuer, opts) {
  opts = opts || {};

  var baseCurrency = Currency.from_json(opts.base_currency);

  var mantissa_hex = quality.substring(quality.length - 14);
  var offset_hex = quality.substring(quality.length - 16, quality.length - 14);
  var mantissa = new BigNumber(mantissa_hex, 16);
  var offset = parseInt(offset_hex, 16) - 100;

  var value = new BigNumber(mantissa.toString() + 'e' + offset.toString());

  this._currency = Currency.from_json(counterCurrency);
  this._issuer = UInt160.from_json(counterIssuer);
  this._is_native = this._currency.is_native();

  if (this._is_native && baseCurrency.is_native()) {
    throw new Error('XDV/XDV quality is not allowed');
  }

  /*
  The quality, as stored in the last 64 bits of a directory index, is stored as
  the quotient of TakerPays/TakerGets.

  When `opts.inverse` is true we are looking at a quality used for determining a
  `bid` price and it must first be inverted, before our declared base/counter
  currencies are in line with the price.

  For example:

    quality as stored :  5 USD          /  3000000 drops
    inverted          :  3000000 drops  /          5 USD
  */
  var adjusted = opts.inverse ? inverse(value) : value;
  var nativeAdjusted = adjusted;

  if (!opts.xdv_as_drops) {
    // `In a currency exchange, the exchange rate is quoted as the units of the
    //  counter currency in terms of a single unit of a base currency`. A
    //  quality is how much taker must `pay` to get ONE `gets` unit thus:
    //    pays ~= counterCurrency
    //    gets ~= baseCurrency.
    if (this._is_native) {
      // pay:$price              drops  get:1 X
      // pay:($price / 1,000,000)  XDV  get:1 X
      nativeAdjusted = adjusted.div(Amount.bi_xns_unit);
    } else if (baseCurrency.is_valid() && baseCurrency.is_native()) {
      // pay:$price X                   get:1 drop
      // pay:($price * 1,000,000) X     get:1 XDV
      nativeAdjusted = adjusted.times(Amount.bi_xns_unit);
    }
  }

  this._set_value(nativeAdjusted);

  if (opts.reference_date && baseCurrency.is_valid()
    && baseCurrency.has_interest()) {
    var interest = baseCurrency.get_interest_at(opts.reference_date);
    this._set_value(this._value.dividedBy(interest.toString()));
  }

  return this;
};

Amount.prototype.parse_number = function(n) {
  this._is_native = false;
  this._currency = Currency.from_json(1);
  this._issuer = UInt160.from_json(1);
  this._set_value(new BigNumber(n));
  return this;
};

// <-> j
Amount.prototype.parse_json = function(j) {
  switch (typeof j) {
    case 'string':
      // .../.../... notation is not a wire format.  But allowed for easier
      // testing.
      var m = j.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);

      if (m) {
        this._currency = Currency.from_json(m[2]);
        if (m[3]) {
          this._issuer = UInt160.from_json(m[3]);
        } else {
          this._issuer = UInt160.from_json('1');
        }
        this.parse_value(m[1]);
      } else {
        this.parse_native(j);
        this._currency = Currency.from_json('0');
        this._issuer = UInt160.from_json('0');
      }
      break;

    case 'number':
      this.parse_json(String(j));
      break;

    case 'object':
      if (j === null) {
        break;
      }

      if (j instanceof Amount) {
        j.copyTo(this);
      } else if (j.hasOwnProperty('value')) {
        // Parse the passed value to sanitize and copy it.
        this._currency.parse_json(j.currency, true); // Never XDV.

        if (typeof j.issuer === 'string') {
          this._issuer.parse_json(j.issuer);
        }

        this.parse_value(j.value);
      }
      break;

    default:
      this._set_value(new BigNumber(NaN));
  }

  return this;
};

// Parse a XDV value from untrusted input.
// - integer = raw units
// - float = with precision 6
// XXX Improvements: disallow leading zeros.
Amount.prototype.parse_native = function(j) {
  if (j && typeof j === 'string' && !isNaN(j)) {
    if (j.indexOf('.') >= 0) {
      throw new Error('Native amounts must be specified in integer drops');
    }
    var value = new BigNumber(j);
    this._is_native = true;
    this._set_value(value.dividedBy(Amount.bi_xns_unit));
  } else {
    this._set_value(new BigNumber(NaN));
  }

  return this;
};

// Parse a non-native value for the json wire format.
// Requires _currency to be set!
Amount.prototype.parse_value = function(j) {
  this._is_native = false;
  this._set_value(new BigNumber(j), BigNumber.ROUND_DOWN);
  return this;
};

Amount.prototype.set_currency = function(c) {
  this._currency = Currency.from_json(c);
  this._is_native = this._currency.is_native();
  return this;
};

Amount.prototype.set_issuer = function(issuer) {
  if (issuer instanceof UInt160) {
    this._issuer = issuer;
  } else {
    this._issuer = UInt160.from_json(issuer);
  }

  return this;
};

Amount.prototype.to_number = function() {
  return Number(this.to_text());
};

// Convert only value to JSON wire format.
Amount.prototype.to_text = function() {
  if (!this.is_valid()) {
    return 'NaN';
  }

  if (this._is_native) {
    return this._value.times(Amount.bi_xns_unit).toString();
  }

  // not native
  var offset = this._value.e - 15;
  var sign = this._value.isNegative() ? '-' : '';
  var mantissa = utils.getMantissaDecimalString(this._value.absoluteValue());
  if (offset !== 0 && (offset < -25 || offset > -4)) {
    // Use e notation.
    // XXX Clamp output.
    return sign + mantissa.toString() + 'e' + offset.toString();
  }

  var val = '000000000000000000000000000'
  + mantissa.toString()
  + '00000000000000000000000';
  var pre = val.substring(0, offset + 43);
  var post = val.substring(offset + 43);
  var s_pre = pre.match(/[1-9].*$/);  // Everything but leading zeros.
  var s_post = post.match(/[1-9]0*$/); // Last non-zero plus trailing zeros.

  return sign + (s_pre ? s_pre[0] : '0')
  + (s_post ? '.' + post.substring(0, 1 + post.length - s_post[0].length) : '');
};

/**
 * Calculate present value based on currency and a reference date.
 *
 * This only affects demurraging and interest-bearing currencies.
 *
 * User should not store amount objects after the interest is applied. This is
 * intended by display functions such as toHuman().
 *
 * @param {Date|Number} referenceDate Date based on which demurrage/interest
 *   should be applied. Can be given as JavaScript Date or int for Divvy epoch.
 * @return {Amount} The amount with interest applied.
 */
Amount.prototype.applyInterest = function(referenceDate) {
  if (!this._currency.has_interest()) {
    return this;
  }
  var interest = this._currency.get_interest_at(referenceDate);
  return this._copy(this._value.times(interest.toString()));
};

/**
 * Format only value in a human-readable format.
 *
 * @example
 *   var pretty = amount.to_human({precision: 2});
 *
 * @param {Object} opts Options for formatter.
 * @param {Number} opts.precision Max. number of digits after decimal point.
 * @param {Number} opts.min_precision Min. number of digits after dec. point.
 * @param {Boolean} opts.skip_empty_fraction Don't show fraction if it is zero,
 *   even if min_precision is set.
 * @param {Number} opts.max_sig_digits Maximum number of significant digits.
 *   Will cut fractional part, but never integer part.
 * @param {Boolean|String} opts.group_sep Whether to show a separator every n
 *   digits, if a string, that value will be used as the separator. Default: ','
 * @param {Number} opts.group_width How many numbers will be grouped together,
 *   default: 3.
 * @param {Boolean|String} opts.signed Whether negative numbers will have a
 *   prefix. If String, that string will be used as the prefix. Default: '-'
 * @param {Date|Number} opts.reference_date Date based on which
 * demurrage/interest should be applied. Can be given as JavaScript Date or int
 * for Divvy epoch.
 * @return {String} amount string
 */
Amount.prototype.to_human = function(opts) {
  opts = opts || {};

  if (!this.is_valid()) {
    return 'NaN';
  }

  /* eslint-disable consistent-this */
  // Apply demurrage/interest
  var ref = this;
  /* eslint-enable consistent-this */

  if (opts.reference_date) {
    ref = this.applyInterest(opts.reference_date);
  }

  var isNegative = ref._value.isNegative();
  var valueString = ref._value.abs().toFixed();
  var parts = valueString.split('.');
  var int_part = parts[0];
  var fraction_part = parts.length === 2 ? parts[1] : '';

  int_part = int_part.replace(/^0*/, '');
  fraction_part = fraction_part.replace(/0*$/, '');

  if (fraction_part.length || !opts.skip_empty_fraction) {
    // Enforce the maximum number of decimal digits (precision)
    if (typeof opts.precision === 'number') {
      var precision = Math.max(0, opts.precision);
      precision = Math.min(precision, fraction_part.length);
      var rounded = Number('0.' + fraction_part).toFixed(precision);

      if (rounded < 1) {
        fraction_part = rounded.substring(2);
      } else {
        int_part = (Number(int_part) + 1).toString();
        fraction_part = '';
      }

      while (fraction_part.length < precision) {
        fraction_part = '0' + fraction_part;
      }
    }

    // Limit the number of significant digits (max_sig_digits)
    if (typeof opts.max_sig_digits === 'number') {
      // First, we count the significant digits we have.
      // A zero in the integer part does not count.
      var int_is_zero = Number(int_part) === 0;
      var digits = int_is_zero ? 0 : int_part.length;

      // Don't count leading zeros in the fractional part if the integer part is
      // zero.
      var sig_frac = int_is_zero
      ? fraction_part.replace(/^0*/, '')
      : fraction_part;
      digits += sig_frac.length;

      // Now we calculate where we are compared to the maximum
      var rounding = digits - opts.max_sig_digits;

      // If we're under the maximum we want to cut no (=0) digits
      rounding = Math.max(rounding, 0);

      // If we're over the maximum we still only want to cut digits from the
      // fractional part, not from the integer part.
      rounding = Math.min(rounding, fraction_part.length);

      // Now we cut `rounding` digits off the right.
      if (rounding > 0) {
        fraction_part = fraction_part.slice(0, -rounding);
      }
    }

    // Enforce the minimum number of decimal digits (min_precision)
    if (typeof opts.min_precision === 'number') {
      opts.min_precision = Math.max(0, opts.min_precision);
      while (fraction_part.length < opts.min_precision) {
        fraction_part += '0';
      }
    }
  }

  if (opts.group_sep !== false) {
    var sep = (typeof opts.group_sep === 'string') ? opts.group_sep : ',';
    var groups = utils.chunkString(int_part, opts.group_width || 3, true);
    int_part = groups.join(sep);
  }

  var formatted = '';
  if (isNegative && opts.signed !== false) {
    formatted += '-';
  }

  formatted += int_part.length ? int_part : '0';
  formatted += fraction_part.length ? '.' + fraction_part : '';

  return formatted;
};

Amount.prototype.to_human_full = function(opts) {
  opts = opts || {};
  var value = this.to_human(opts);
  var currency = this._currency.to_human();
  var issuer = this._issuer.to_json(opts);
  var base = value + '/' + currency;
  return this.is_native() ? base : (base + '/' + issuer);
};

Amount.prototype.to_json = function() {
  if (this._is_native) {
    return this.to_text();
  }

  var amount_json = {
    value: this.to_text(),
    currency: this._currency.has_interest() ?
    this._currency.to_hex() : this._currency.to_json()
  };

  if (this._issuer.is_valid()) {
    amount_json.issuer = this._issuer.to_json();
  }

  return amount_json;
};

Amount.prototype.to_text_full = function(opts) {
  if (!this.is_valid()) {
    return 'NaN';
  }
  return this._is_native
      ? this.to_human() + '/XDV'
      : this.to_text() + '/' + this._currency.to_json()
        + '/' + this._issuer.to_json(opts);
};

// For debugging.
Amount.prototype.not_equals_why = function(d, ignore_issuer) {
  if (typeof d === 'string') {
    return this.not_equals_why(Amount.from_json(d));
  }
  if (!(d instanceof Amount)) {
    return 'Not an Amount';
  }
  if (!this.is_valid() || !d.is_valid()) {
    return 'Invalid amount.';
  }
  if (this._is_native !== d._is_native) {
    return 'Native mismatch.';
  }

  var type = this._is_native ? 'XDV' : 'Non-XDV';
  if (!this._value.isZero() && this._value.negated().equals(d._value)) {
    return type + ' sign differs.';
  }
  if (!this._value.equals(d._value)) {
    return type + ' value differs.';
  }
  if (!this._is_native) {
    if (!this._currency.equals(d._currency)) {
      return 'Non-XDV currency differs.';
    }
    if (!ignore_issuer && !this._issuer.equals(d._issuer)) {
      return 'Non-XDV issuer differs: '
      + d._issuer.to_json()
      + '/'
      + this._issuer.to_json();
    }
  }
};

exports.Amount = Amount;

// DEPRECATED: Include the corresponding files instead.
exports.Currency = Currency;
exports.Seed = Seed;
exports.UInt160 = UInt160;

// vim:sw=2:sts=2:ts=8:et
