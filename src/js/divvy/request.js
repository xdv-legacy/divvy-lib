var EventEmitter = require('events').EventEmitter;
var util         = require('util');
var async        = require('async');
var UInt160      = require('./uint160').UInt160;
var Currency     = require('./currency').Currency;
var DivvyError  = require('./divvyerror').DivvyError;
var Server       = require('./server').Server;

// Request events emitted:
//  'success' : Request successful.
//  'error'   : Request failed.
//  'remoteError'
//  'remoteUnexpected'
//  'remoteDisconnected'

/**
 * Request
 *
 * @param {Remote} remote
 * @param {String} command
 */

function Request(remote, command) {
  EventEmitter.call(this);

  this.remote = remote;
  this.requested = false;
  this.reconnectTimeout = 1000 * 3;
  this.successEvent = 'success';
  this.errorEvent = 'error';
  this.message = {
    command: command,
    id: void(0)
  };
};

util.inherits(Request, EventEmitter);

// Send the request to a remote.
Request.prototype.request = function(servers, callback) {
  this.emit('before');

  if (typeof servers === 'function') {
    callback = servers;
  }

  this.callback(callback);

  if (this.requested) {
    return this;
  }

  this.requested = true;
  this.on('error', function(){});
  this.emit('request', this.remote);

  if (Array.isArray(servers)) {
    servers.forEach(function(server) {
      this.setServer(server);
      this.remote.request(this);
    }, this);
  } else {
    this.remote.request(this);
  }

  return this;
};

/**
 * Broadcast request to all servers, filter responses if a function is
 * provided. Return first response that satisfies the filter. Pre-filter
 * requests by ledger_index (if a ledger_index is set on the request), and
 * automatically retry servers when they reconnect--if they are expected to
 *
 * Whew
 *
 * @param [Function] fn
 */

Request.prototype.filter =
Request.prototype.addFilter =
Request.prototype.broadcast = function(filterFn) {
  var self = this;

  if (!this.requested) {
    // Defer until requested, and prevent the normal request() from executing
    this.once('before', function() {
      self.requested = true;
      self.broadcast(filterFn);
    });
    return this;
  }

  var filterFn = typeof filterFn === 'function' ? filterFn : Boolean;
  var lastResponse = new Error('No servers available');
  var connectTimeouts = { };
  var emit = this.emit;

  this.emit = function(event, a, b) {
    // Proxy success/error events
    switch (event) {
      case 'success':
      case 'error':
        emit.call(self, 'proposed', a, b);
        break;
      default:
        emit.apply(self, arguments);
    }
  };

  function iterator(server, callback) {
    // Iterator is called in parallel

    if (server.isConnected()) {
      // Listen for proxied success/error event and apply filter
      self.once('proposed', function(res) {
        lastResponse = res;
        callback(filterFn(res));
      });

      return server._request(self);
    }

    // Server is disconnected but should reconnect. Wait for it to reconnect,
    // and abort after a timeout
    var serverID = server.getServerID();

    function serverReconnected() {
      clearTimeout(connectTimeouts[serverID]);
      connectTimeouts[serverID] = null;
      iterator(server, callback);
    };

    connectTimeouts[serverID] = setTimeout(function() {
      server.removeListener('connect', serverReconnected);
      callback(false);
    }, self.reconnectTimeout);

    server.once('connect', serverReconnected);
  };

  function complete(success) {
    // Emit success if the filter is satisfied by any server
    // Emit error if the filter is not satisfied by any server
    // Include the last response
    emit.call(self, success ? 'success' : 'error', lastResponse);
  };

  var servers = this.remote._servers.filter(function(server) {
    // Pre-filter servers that are disconnected and should not reconnect
    return (server.isConnected() || server._shouldConnect)
    // Pre-filter servers that do not contain the ledger in request
    && (!self.message.hasOwnProperty('ledger_index')
        || server.hasLedger(self.message.ledger_index))
    && (!self.message.hasOwnProperty('ledger_index_min')
      || self.message.ledger_index_min === -1
      || server.hasLedger(self.message.ledger_index_min))
    && (!self.message.hasOwnProperty('ledger_index_max')
      || self.message.ledger_index_max === -1
      || server.hasLedger(self.message.ledger_index_max))
  });

  // Apply iterator in parallel to connected servers, complete when the
  // supplied filter function is satisfied once by a server's response
  async.some(servers, iterator, complete);

  return this;
};

Request.prototype.cancel = function() {
  this.removeAllListeners();
  this.on('error', function(){});

  return this;
};

Request.prototype.setCallback = function(fn) {
  if (typeof fn === 'function') {
    this.callback(fn);
  }

  return this;
};

Request.prototype.setReconnectTimeout = function(timeout) {
  if (typeof timeout === 'number' && !isNaN(timeout)) {
    this.reconnectTimeout = timeout;
  }

  return this;
};

Request.prototype.callback = function(callback, successEvent, errorEvent) {
  var self = this;

  if (typeof callback !== 'function') {
    return this;
  }

  if (typeof successEvent === 'string') {
    this.successEvent = successEvent;
  }
  if (typeof errorEvent === 'string') {
    this.errorEvent = errorEvent;
  }

  var called = false;

  function requestSuccess(message) {
    if (!called) {
      called = true;
      callback.call(self, null, message);
    }
  };

  function requestError(error) {
    if (!called) {
      called = true;

      if (!(error instanceof DivvyError)) {
        error = new DivvyError(error);
      }

      callback.call(self, error);
    }
  };

  this.once(this.successEvent, requestSuccess);
  this.once(this.errorEvent, requestError);
  this.request();

  return this;
};

Request.prototype.timeout = function(duration, callback) {
  var self = this;

  function requested() {
    self.timeout(duration, callback);
  };

  if (!this.requested) {
    // Defer until requested
    return this.once('request', requested);
  }

  var emit = this.emit;
  var timed_out = false;

  var timeout = setTimeout(function() {
    timed_out = true;

    if (typeof callback === 'function') {
      callback();
    }

    emit.call(self, 'timeout');
    self.cancel();
  }, duration);

  this.emit = function() {
    if (!timed_out) {
      clearTimeout(timeout);
      emit.apply(self, arguments);
    }
  };

  return this;
};

Request.prototype.setServer = function(server) {
  var selected = null;

  switch (typeof server) {
    case 'object':
      selected = server;
      break;

    case 'string':
      // Find server by URL
      var servers = this.remote._servers;

      for (var i=0, s; (s=servers[i]); i++) {
        if (s._url === server) {
          selected = s;
          break;
        }
      }
      break;
  };

  this.server = selected;

  return this;
};

Request.prototype.buildPath = function(build) {
  if (this.remote.local_signing) {
    throw new Error(
      '`build_path` is completely ignored when doing local signing as '
      + '`Paths` is a component of the signed blob. The `tx_blob` is signed,'
      + 'sealed and delivered, and the txn unmodified after' );
  }

  if (build) {
    this.message.build_path = true;
  } else {
    // ND: divvyd currently intreprets the mere presence of `build_path` as the
    // value being `truthy`
    delete this.message.build_path;
  }

  return this;
};

Request.prototype.ledgerChoose = function(current) {
  if (current) {
    this.message.ledger_index = this.remote._ledger_current_index;
  } else {
    this.message.ledger_hash  = this.remote._ledger_hash;
  }

  return this;
};

// Set the ledger for a request.
// - ledger_entry
// - transaction_entry
Request.prototype.ledgerHash = function(hash) {
  this.message.ledger_hash = hash;
  return this;
};

// Set the ledger_index for a request.
// - ledger_entry
Request.prototype.ledgerIndex = function(ledger_index) {
  this.message.ledger_index = ledger_index;
  return this;
};

/**
 * Set either ledger_index or ledger_hash based on heuristic
 *
 * @param {Number|String} ledger identifier
 */

Request.prototype.selectLedger =
Request.prototype.ledgerSelect = function(ledger) {
  switch (ledger) {
    case 'current':
    case 'closed':
    case 'validated':
      this.message.ledger_index = ledger;
      break;
    default:
      if (Number(ledger) && isFinite(Number(ledger))) {
        this.message.ledger_index = Number(ledger);
      } else if (/^[A-F0-9]{64}$/.test(ledger)) {
        this.message.ledger_hash = ledger;
      }
      break;
  }

  return this;
};

Request.prototype.accountRoot = function(account) {
  this.message.account_root = UInt160.json_rewrite(account);
  return this;
};

Request.prototype.index = function(index) {
  this.message.index = index;
  return this;
};

// Provide the information id an offer.
// --> account
// --> seq : sequence number of transaction creating offer (integer)
Request.prototype.offerId = function(account, sequence) {
  this.message.offer = {
    account: UInt160.json_rewrite(account),
    seq: sequence
  };
  return this;
};

// --> index : ledger entry index.
Request.prototype.offerIndex = function(index) {
  this.message.offer = index;
  return this;
};

Request.prototype.secret = function(secret) {
  if (secret) {
    this.message.secret = secret;
  }
  return this;
};

Request.prototype.txHash = function(hash) {
  this.message.tx_hash = hash;
  return this;
};

Request.prototype.txJson = function(json) {
  this.message.tx_json = json;
  return this;
};

Request.prototype.txBlob = function(json) {
  this.message.tx_blob = json;
  return this;
};

Request.prototype.divvyState = function(account, issuer, currency) {
  this.message.divvy_state = {
    currency: currency,
    accounts: [
      UInt160.json_rewrite(account),
      UInt160.json_rewrite(issuer)
    ]
  };
  return this;
};

Request.prototype.setAccounts =
Request.prototype.accounts = function(accounts, proposed) {
  if (!Array.isArray(accounts)) {
    accounts = [ accounts ];
  }

  // Process accounts parameters
  var processedAccounts = accounts.map(function(account) {
    return UInt160.json_rewrite(account);
  });

  if (proposed) {
    this.message.accounts_proposed = processedAccounts;
  } else {
    this.message.accounts = processedAccounts;
  }

  return this;
};

Request.prototype.addAccount = function(account, proposed) {
  if (Array.isArray(account)) {
    account.forEach(this.addAccount, this);
    return this;
  }

  var processedAccount = UInt160.json_rewrite(account);
  var prop = proposed === true ? 'accounts_proposed' : 'accounts';
  this.message[prop] = (this.message[prop] || []).concat(processedAccount);

  return this;
};

Request.prototype.setAccountsProposed =
Request.prototype.rtAccounts =
Request.prototype.accountsProposed = function(accounts) {
  return this.accounts(accounts, true);
};

Request.prototype.addAccountProposed = function(account) {
  if (Array.isArray(account)) {
    account.forEach(this.addAccountProposed, this);
    return this;
  }

  return this.addAccount(account, true);
};

Request.prototype.setBooks =
Request.prototype.books = function(books, snapshot) {
  // Reset list of books (this method overwrites the current list)
  this.message.books = [ ];

  for (var i=0, l=books.length; i<l; i++) {
    var book = books[i];
    this.addBook(book, snapshot);
  }

  return this;
};

Request.prototype.addBook = function(book, snapshot) {
  if (Array.isArray(book)) {
    book.forEach(this.addBook, this);
    return this;
  }

  var json = { };

  function processSide(side) {
    if (!book[side]) {
      throw new Error('Missing ' + side);
    }

    var obj = json[side] = {
      currency: Currency.json_rewrite(book[side].currency, { force_hex: true })
    };

    if (!Currency.from_json(obj.currency).is_native()) {
      obj.issuer = UInt160.json_rewrite(book[side].issuer);
    }
  }

  [ 'taker_gets', 'taker_pays' ].forEach(processSide);

  if (typeof snapshot !== 'boolean') {
    json.snapshot = true;
  } else if (snapshot) {
    json.snapshot = true;
  } else {
    delete json.snapshot;
  }

  if (book.both) {
    json.both = true;
  }

  this.message.books = (this.message.books || []).concat(json);

  return this;
};

Request.prototype.addStream = function(stream, values) {
  var self = this;

  if (Array.isArray(values)) {
    switch (stream) {
      case 'accounts':
        this.addAccount(values);
        break;
      case 'accounts_proposed':
        this.addAccountProposed(values);
        break;
      case 'books':
        this.addBook(values);
        break;
    }
  } else if (arguments.length > 1) {
    for (arg in arguments) {
      this.addStream(arguments[arg]);
    }
    return;
  }

  if (!Array.isArray(this.message.streams)) {
    this.message.streams = [ ];
  }

  if (this.message.streams.indexOf(stream) === -1) {
    this.message.streams.push(stream);
  }

  return this;
};

exports.Request = Request;
