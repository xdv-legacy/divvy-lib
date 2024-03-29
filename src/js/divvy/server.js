var util         = require('util');
var url          = require('url');
var LRU          = require('lru-cache');
var EventEmitter = require('events').EventEmitter;
var Amount       = require('./amount').Amount;
var RangeSet     = require('./rangeset').RangeSet;
var log          = require('./log').internal.sub('server');

/**
 *  @constructor Server
 *
 *  @param {Remote} Reference to a Remote object
 *  @param {Object} Options
 *    @param {String} host
 *    @param {Number|String} port
 *    @param [Boolean] securec
 */

function Server(remote, opts) {
  EventEmitter.call(this);

  var self = this;

  if (typeof opts === 'string') {
    var parsedUrl = url.parse(opts);
    opts = {
      host: parsedUrl.hostname,
      port: parsedUrl.port,
      secure: (parsedUrl.protocol === 'ws:') ? false : true
    };
  }

  if (typeof opts !== 'object') {
    throw new TypeError('Server configuration is not an Object');
  }

  if (!Server.DOMAIN_RE.test(opts.host)) {
    throw new Error('Server host is malformed, use "host" and "port" server configuration');
  }

  // We want to allow integer strings as valid port numbers for backward compatibility
  if (!(opts.port = Number(opts.port))) {
    throw new TypeError('Server port must be a number');
  }

  if (opts.port < 1 || opts.port > 65535) {
    throw new TypeError('Server "port" must be an integer in range 1-65535');
  }

  if (typeof opts.secure !== 'boolean') {
    opts.secure = true;
  }

  this._remote = remote;
  this._opts = opts;
  this._ws = void(0);

  this._connected = false;
  this._shouldConnect = false;
  this._state = 'offline';
  this._ledgerRanges = new RangeSet();
  this._ledgerMap = LRU({ max: 200 });

  this._id = 0; // request ID
  this._retry = 0;
  this._requests = { };

  this._load_base = 256;
  this._load_factor = 256;

  this._fee = 10;
  this._fee_ref = 10;
  this._fee_base = 10;
  this._reserve_base = void(0);
  this._reserve_inc = void(0);
  this._fee_cushion = this._remote.fee_cushion;

  this._lastLedgerIndex = NaN;
  this._lastLedgerClose = NaN;

  this._score = 0;
  this._scoreWeights = {
    ledgerclose: 5,
    response: 1
  };

  this._pubkey_node = '';

  this._url = this._opts.url = (this._opts.secure ? 'wss://' : 'ws://')
      + this._opts.host + ':' + this._opts.port;

  this.on('message', function onMessage(message) {
    self._handleMessage(message);
  });

  this.on('response_subscribe', function onSubscribe(message) {
    self._handleResponseSubscribe(message);
  });

  function setActivityInterval() {
    var interval = self._checkActivity.bind(self);
    self._activityInterval = setInterval(interval, 1000);
  };

  this.on('disconnect', function onDisconnect() {
    clearInterval(self._activityInterval);
    self.once('ledger_closed', setActivityInterval);
  });

  this.once('ledger_closed', setActivityInterval);

  this._remote.on('ledger_closed', function onRemoteLedgerClose(ledger) {
    self._updateScore('ledgerclose', ledger);
  });

  this.on('response_ping', function onPingResponse(message, request) {
    self._updateScore('response', request);
  });

  this.on('load_changed', function onLoadChange(load) {
    self._updateScore('loadchange', load);
  });

  this.on('connect', function() {
    self.requestServerID();
  });
};

util.inherits(Server, EventEmitter);

Server.DOMAIN_RE = /^(?=.{1,255}$)[0-9A-Za-z](?:(?:[0-9A-Za-z]|[-_]){0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:(?:[0-9A-Za-z]|[-_]){0,61}[0-9A-Za-z])?)*\.?$/;

Server.TLS_ERRORS = [
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE', 'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY', 'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE', 'CERT_NOT_YET_VALID', 'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID', 'CRL_HAS_EXPIRED', 'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD', 'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD', 'OUT_OF_MEM',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG', 'CERT_REVOKED', 'INVALID_CA',
  'PATH_LENGTH_EXCEEDED', 'INVALID_PURPOSE', 'CERT_UNTRUSTED',
  'CERT_REJECTED'
];

/**
 * Server states that we will treat as the server being online.
 *
 * Our requirements are that the server can process transactions and notify
 * us of changes.
 */

Server.onlineStates = [
  'syncing',
  'tracking',
  'proposing',
  'validating',
  'full'
];

/**
 * This is the final interface between client code and a socket connection to a
 * `divvyd` server. As such, this is a decent hook point to allow a WebSocket
 * interface conforming object to be used as a basis to mock divvyd. This
 * avoids the need to bind a websocket server to a port and allows a more
 * synchronous style of code to represent a client <-> server message sequence.
 * We can also use this to log a message sequence to a buffer.
 *
 * @api private
 */

Server.websocketConstructor = function() {
  // We require this late, because websocket shims may be loaded after
  // divvy-lib in the browser
  return require('ws');
};

/**
 * Set server state
 *
 * @param {String} state
 * @api private
 */

Server.prototype._setState = function(state) {
  if (state !== this._state) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'set_state:', state);
    }

    this._state = state;
    this.emit('state', state);

    switch (state) {
      case 'online':
        this._connected = true;
        this._retry = 0;
        this.emit('connect');
        break;
      case 'offline':
        this._connected = false;
        this.emit('disconnect');
        break;
    }
  }
};

/**
 * Check that server is still active.
 *
 * Server activity is determined by ledger_closed events.
 * Maximum delay to receive a ledger_closed event is 20s.
 *
 * If server is inactive, reconnect
 *
 * @api private
 */

Server.prototype._checkActivity = function() {
  if (!this.isConnected()) {
    return;
  }

  if (isNaN(this._lastLedgerClose)) {
    return;
  }

  var delta = (Date.now() - this._lastLedgerClose);

  if (delta > (1000 * 25)) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'reconnect: activity delta:', delta);
    }
    this.reconnect();
  }
};

/**
 * If server is not up-to-date, request server_info for getting pubkey_node
 * & hostid information. Otherwise this information is available on the
 * initial server subscribe response
 */

Server.prototype.requestServerID = function() {
  var self = this;

  if (this._pubkey_node) {
    return;
  }

  this.on('response_server_info', function setServerID(message) {
    try {
      self._pubkey_node = message.info.pubkey_node;
    } catch (e) {
    }
  });

  var serverInfoRequest = this._remote.requestServerInfo();
  serverInfoRequest.on('error', function() { });
  this._request(serverInfoRequest);
};

/**
 * Server maintains a score for request prioritization.
 *
 * The score is determined by various data including
 * this server's lag to receive ledger_closed events,
 * ping response time, and load(fee) change
 *
 * @param {String} type
 * @param {Object} data
 * @api private
 */

Server.prototype._updateScore = function(type, data) {
  if (!this.isConnected()) {
    return;
  }

  var weight = this._scoreWeights[type] || 1;

  switch (type) {
    case 'ledgerclose':
      // Ledger lag
      var delta = data.ledger_index - this._lastLedgerIndex;
      if (delta > 0) {
        this._score += weight * delta;
      }
      break;
    case 'response':
      // Ping lag
      var delta = Math.floor((Date.now() - data.time) / 200);
      this._score += weight * delta;
      break;
    case 'loadchange':
      // Load/fee change
      this._fee = Number(this._computeFee(10));
      break;
  }

  if (this._score > 1e3) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'reconnect: score:', this._score);
    }
    this.reconnect();
  }
};

/**
 * Get the server's remote address
 *
 * Incompatible with divvy-lib client build
 */

Server.prototype.getRemoteAddress =
Server.prototype._remoteAddress = function() {
  var address;
  try {
    address = this._ws._socket.remoteAddress;
  } catch (e) {
  }
  return address;
};

/**
 * Get the server's hostid
 */

Server.prototype.getHostID =
Server.prototype.getServerID = function() {
  return this._url + ' (' + (this._pubkey_node ? this._pubkey_node : '') + ')';
};

/**
 * Disconnect from divvyd WebSocket server
 *
 * @api public
 */

Server.prototype.disconnect = function() {
  var self = this;

  if (!this.isConnected()) {
    this.once('socket_open', function() {
      self.disconnect();
    });
    return;
  }

  //these need to be reset so that updateScore 
  //and checkActivity do not trigger reconnect
  this._lastLedgerIndex = NaN;
  this._lastLedgerClose = NaN;
  this._score = 0;
  this._shouldConnect = false;
  this._ledgerRanges.reset();
  this._ledgerMap.reset();
  this._setState('offline');

  if (this._ws) {
    this._ws.close();
  }
};

/**
 * Reconnect to divvyd WebSocket server
 *
 * @api public
 */

Server.prototype.reconnect = function() {
  var self = this;

  function reconnect() {
    self._shouldConnect = true;
    self._retry = 0;
    self.connect();
  };

  if (this._ws && this._shouldConnect) {
    if (this.isConnected()) {
      this.once('disconnect', reconnect);
      this.disconnect();
    } else {
      reconnect();
    }
  }
};

/**
 * Connect to divvyd WebSocket server and subscribe to events that are
 * internally requisite. Automatically retry connections with a gradual
 * back-off
 *
 * @api public
 */

Server.prototype.connect = function() {
  var self = this;

  var WebSocket = Server.websocketConstructor();

  if (!WebSocket) {
    throw new Error('No websocket support detected!');
  }

  // We don't connect if we believe we're already connected. This means we have
  // recently received a message from the server and the WebSocket has not
  // reported any issues either. If we do fail to ping or the connection drops,
  // we will automatically reconnect.
  if (this.isConnected()) {
    return;
  }

  // Ensure any existing socket is given the command to close first.
  if (this._ws) {
    this._ws.close();
  }

  if (this._remote.trace) {
    log.info(this.getServerID(), 'connect');
  }

  var ws = this._ws = new WebSocket(this._opts.url);

  this._shouldConnect = true;

  self.emit('connecting');

  ws.onmessage = function onMessage(msg) {
    self.emit('message', msg.data);
  };

  ws.onopen = function onOpen() {
    if (ws === self._ws) {
      self.emit('socket_open');
      // Subscribe to events
      self._request(self._remote._serverPrepareSubscribe(self));
    }
  };

  ws.onerror = function onError(e) {
    if (ws === self._ws) {
      self.emit('socket_error');

      if (self._remote.trace) {
        log.info(self.getServerID(), 'onerror:',  e.data || e);
      }

      if (Server.TLS_ERRORS.indexOf(e.message) !== -1) {
        // Unrecoverable
        throw e;
      }

      // Most connection errors for WebSockets are conveyed as 'close' events with
      // code 1006. This is done for security purposes and therefore unlikely to
      // ever change.

      // This means that this handler is hardly ever called in practice. If it is,
      // it probably means the server's WebSocket implementation is corrupt, or
      // the connection is somehow producing corrupt data.

      // Most WebSocket applications simply log and ignore this error. Once we
      // support for multiple servers, we may consider doing something like
      // lowering this server's quality score.

      // However, in Node.js this event may be triggered instead of the close
      // event, so we need to handle it.
      self._handleClose();
    }
  };

  ws.onclose = function onClose() {
    if (ws === self._ws) {
      if (self._remote.trace) {
        log.info(self.getServerID(), 'onclose:', ws.readyState);
      }
      self._handleClose();
    }
  };
};

/**
 * Retry connection to divvyd server
 *
 * @api private
 */

Server.prototype._retryConnect = function() {
  var self = this;

  this._retry += 1;

  var retryTimeout = (this._retry < 40)
  // First, for 2 seconds: 20 times per second
  ? (1000 / 20)
  : (this._retry < 40 + 60)
  // Then, for 1 minute: once per second
  ? (1000)
  : (this._retry < 40 + 60 + 60)
  // Then, for 10 minutes: once every 10 seconds
  ? (10 * 1000)
  // Then: once every 30 seconds
  : (30 * 1000);

  function connectionRetry() {
    if (self._shouldConnect) {
      if (self._remote.trace) {
        log.info(self.getServerID(), 'retry', self._retry);
      }
      self.connect();
    }
  };

  this._retryTimer = setTimeout(connectionRetry, retryTimeout);
};

/**
 * Handle connection closes
 *
 * @api private
 */

Server.prototype._handleClose = function() {
  var self = this;
  var ws = this._ws;

  function noOp(){};

  // Prevent additional events from this socket
  ws.onopen = ws.onerror = ws.onclose = ws.onmessage = noOp;

  this.emit('socket_close');
  this._setState('offline');

  if (this._shouldConnect) {
    this._retryConnect();
  }
};

/**
 * Handle incoming messages from divvyd WebSocket server
 *
 * @param {JSON-parseable} message
 * @api private
 */

Server.prototype._handleMessage = function(message) {
  var self = this;

  try {
    message = JSON.parse(message);
  } catch(e) {
  }

  if (!Server.isValidMessage(message)) {
    this.emit('unexpected', message);
    return;
  }

  switch (message.type) {
    case 'ledgerClosed':
      this._handleLedgerClosed(message);
      break;
    case 'serverStatus':
      this._handleServerStatus(message);
      break;
    case 'response':
      this._handleResponse(message);
      break;
    case 'path_find':
      this._handlePathFind(message);
      break;
  }
};

Server.prototype._handleLedgerClosed = function(message) {
  this._lastLedgerIndex = message.ledger_index;
  this._lastLedgerClose = Date.now();
  this._ledgerRanges.add(message.ledger_index);
  this._ledgerMap.set(message.ledger_hash, message.ledger_index);
  this.emit('ledger_closed', message);
};

Server.prototype._handleServerStatus = function(message) {
  // This message is only received when online.
  // As we are connected, it is the definitive final state.
  var isOnline = ~Server.onlineStates.indexOf(message.server_status);

  this._setState(isOnline ? 'online' : 'offline');

  if (!Server.isLoadStatus(message)) {
    return;
  }

  this.emit('load', message, this);
  this._remote.emit('load', message, this);

  var loadChanged = message.load_base !== this._load_base
  || message.load_factor !== this._load_factor;

  if (loadChanged) {
    this._load_base = message.load_base;
    this._load_factor = message.load_factor;
    this.emit('load_changed', message, this);
    this._remote.emit('load_changed', message, this);
  }
};

Server.prototype._handleResponse = function(message) {
  // A response to a request.
  var request = this._requests[message.id];

  delete this._requests[message.id];

  if (!request) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'UNEXPECTED:', message);
    }
    return;
  }

  if (message.status === 'success') {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'response:', message);
    }

    var command = request.message.command;
    var result = message.result;
    var responseEvent = 'response_' + command;

    request.emit('success', result);

    [ this, this._remote ].forEach(function(emitter) {
      emitter.emit(responseEvent, result, request, message);
    });
  } else if (message.error) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'error:', message);
    }

    request.emit('error', {
      error: 'remoteError',
      error_message: 'Remote reported an error.',
      remote: message
    });
  }
};

Server.prototype._handlePathFind = function(message) {
  if (this._remote.trace) {
    log.info(this.getServerID(), 'path_find:', message);
  }
};

/**
 * Handle initial subscription response message. The server is considered
 * `connected` after it has received a response to initial subscription to
 * ledger and server streams
 *
 * @param {Object} message
 * @api private
 */

Server.prototype._handleResponseSubscribe = function(message) {
  if (this.isConnected()) {
    // This function only concerns initializing the server's internal
    // state after a connection
    return;
  }

  if (!this._remote.allow_partial_history
      && !Server.hasFullLedgerHistory(message)) {
    // Server has partial history and Remote has been configured to disallow
    // servers with incomplete history
    return this.reconnect();
  }

  if (message.pubkey_node) {
    // pubkey_node is used to identify the server
    this._pubkey_node = message.pubkey_node;
  }

  if (Server.isLoadStatus(message)) {
    this._load_base = message.load_base || 256;
    this._load_factor = message.load_factor || 256;
    this._fee_ref = message.fee_ref || 10;
    this._fee_base = message.fee_base || 10;
    this._reserve_base = message.reserve_base;
    this._reserve_inc = message.reserve_inc;
  }

  if (message.validated_ledgers) {
    // Add validated ledgers to ledger range set
    this._ledgerRanges.add(message.validated_ledgers);
  }

  if (~Server.onlineStates.indexOf(message.server_status)) {
    this._setState('online');
  }
};

/**
 * Check that server message indicates that server has complete ledger history
 *
 * @param {Object} message
 * @return {Boolean}
 */

Server.hasFullLedgerHistory = function(message) {
  return (typeof message === 'object')
  && (message.server_status === 'full')
  && (typeof message.validated_ledgers === 'string')
  && (message.validated_ledgers.split('-').length === 2);
};

/**
 * Check that received message from divvyd is valid
 *
 * @param {Object} message
 * @return {Boolean}
 */

Server.isValidMessage = function(message) {
  return (typeof message === 'object')
      && (typeof message.type === 'string');
};

/**
 * Check that received serverStatus message contains load status information
 *
 * @param {Object} message
 * @return {Boolean}
 */

Server.isLoadStatus = function(message) {
  return (typeof message === 'object')
      && (typeof message.load_base === 'number')
      && (typeof message.load_factor === 'number');
};

/**
 * Send JSON message to divvyd WebSocket server
 *
 * @param {JSON-Stringifiable} message
 * @api private
 */

Server.prototype._sendMessage = function(message) {
  if (this._ws) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'request:', message);
    }
    this._ws.send(JSON.stringify(message));
  }
};

/**
 * Submit a Request object
 *
 * Requests are indexed by message ID, which is repeated in the response from
 * divvyd WebSocket server
 *
 * @param {Request} request
 * @api private
 */

Server.prototype._request = function(request) {
  var self  = this;

  // Only bother if we are still connected.
  if (!this._ws) {
    if (this._remote.trace) {
      log.info(this.getServerID(), 'request: DROPPING:', request.message);
    }
    return;
  }

  request.server = this;
  request.message.id = this._id;
  request.time = Date.now();

  this._requests[request.message.id] = request;

  // Advance message ID
  this._id++;

  function sendRequest() {
    self._sendMessage(request.message);
  };

  var isOpen = this._ws.readyState === 1;
  var isSubscribeRequest = request && request.message.command === 'subscribe';

  if (this.isConnected() || (isOpen && isSubscribeRequest)) {
    sendRequest();
  } else {
    this.once('connect', sendRequest);
  }
};

/**
 * Get server connected status
 *
 * @return boolean
 */

Server.prototype.isConnected =
Server.prototype._isConnected = function() {
  return this._connected;
};

/**
 * Calculate transaction fee
 *
 * @param {Transaction|Number} Fee units for a provided transaction
 * @return {String} Final fee in XDV for specified number of fee units
 * @api private
 */

Server.prototype._computeFee = function(feeUnits) {
  if (isNaN(feeUnits)) {
    throw new Error('Invalid argument');
  }

  return this._feeTx(Number(feeUnits)).to_json();
};

/**
 * Calculate a transaction fee for a number of tx fee units.
 *
 * This takes into account the last known network and local load fees.
 *
 * @param {Number} Fee units for a provided transaction
 * @return {Amount} Final fee in XDV for specified number of fee units.
 */

Server.prototype._feeTx = function(units) {
  var fee_unit = this._feeTxUnit();
  return Amount.from_json(String(Math.ceil(units * fee_unit)));
};

/**
 * Get the current recommended transaction fee unit.
 *
 * Multiply this value with the number of fee units in order to calculate the
 * recommended fee for the transaction you are trying to submit.
 *
 * @return {Number} Recommended amount for one fee unit as float.
 */

Server.prototype._feeTxUnit = function() {
  var fee_unit = this._fee_base / this._fee_ref;

  // Apply load fees
  fee_unit *= this._load_factor / this._load_base;

  // Apply fee cushion (a safety margin in case fees rise since we were last updated)
  fee_unit *= this._fee_cushion;

  return fee_unit;
};

/**
 * Get the current recommended reserve base.
 *
 * Returns the base reserve with load fees and safety margin applied.
 */

Server.prototype._reserve = function(ownerCount) {
  var reserve_base = Amount.from_json(String(this._reserve_base));
  var reserve_inc  = Amount.from_json(String(this._reserve_inc));
  var owner_count  = ownerCount || 0;

  if (owner_count < 0) {
    throw new Error('Owner count must not be negative.');
  }

  return reserve_base.add(reserve_inc.product_human(owner_count));
};

/**
 * Check that server has seen closed ledger
 *
 * @param {string|number} ledger hash or index
 * @return boolean
 */

Server.prototype.hasLedger = function(ledger) {
  var result = false;

  if (typeof ledger === 'string' && /^[A-F0-9]{64}$/.test(ledger)) {
    result = this._ledgerMap.has(ledger);
  } else if (ledger != null && !isNaN(ledger)) {
    result = this._ledgerRanges.has(ledger);
  }

  return result;
};

/**
 * Get ledger index of last seen validated ledger
 *
 * @return number
 */

Server.prototype.getLastLedger =
Server.prototype.getLastLedgerIndex = function() {
  return this._lastLedgerIndex;
};

exports.Server = Server;

// vim:sw=2:sts=2:ts=8:et
