var assert = require('assert');
var Remote = require('divvy-lib').Remote;
var Server = require('divvy-lib').Server;
var Request = require('divvy-lib').Request;
var Transaction = require('divvy-lib').Transaction;
var UInt160 = require('divvy-lib').UInt160;
var Currency = require('divvy-lib').Currency;
var Amount = require('divvy-lib').Amount;
var PathFind = require('../src/js/divvy/pathfind').PathFind;

var options, remote, callback, database, tx;

var ADDRESS = 'r4qLSAzv4LZ9TLsR7diphGwKnSEAMQTSjS';
var PEER_ADDRESS = 'rfYv1TXnwgDDK4WQNbFALykYuEBnrR4pDX';
var LEDGER_INDEX = 9592219;
var LEDGER_HASH = 'B4FD84A73DBD8F0DA9E320D137176EBFED969691DC0AAC7882B76B595A0841AE';
var PAGING_MARKER = '29F992CC252056BF690107D1E8F2D9FBAFF29FF107B62B1D1F4E4E11ADF2CC73';
var TRANSACTION_HASH = '14576FFD5D59FFA73CAA90547BE4DE09926AAB59E981306C32CCE04408CBF8EA';

describe('Remote', function() {
  beforeEach(function() {
    options = {
      trusted: true,
      servers: [ 'wss://s1.divvy.com:443' ]
    };
    remote = new Remote(options);
  });

  it('Server initialization -- url object', function() {
    var remote = new Remote({
      servers: [ { host: 's-west.divvy.com', port: 443, secure: true } ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'wss://s-west.divvy.com:443');
  });

  it('Server initialization -- url object -- no secure property', function() {
    var remote = new Remote({
      servers: [ { host: 's-west.divvy.com', port: 443 } ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'wss://s-west.divvy.com:443');
  });

  it('Server initialization -- url object -- secure: false', function() {
    var remote = new Remote({
      servers: [ { host: 's-west.divvy.com', port: 443, secure: false } ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'ws://s-west.divvy.com:443');
  });

  it('Server initialization -- url object -- string port', function() {
    var remote = new Remote({
      servers: [ { host: 's-west.divvy.com', port: '443', secure: true } ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'wss://s-west.divvy.com:443');
  });

  it('Server initialization -- url object -- invalid host', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ { host: '+', port: 443, secure: true } ]
        });
      }, Error);
  });

  it('Server initialization -- url object -- invalid port', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ { host: 's-west.divvy.com', port: null, secure: true } ]
        });
      }, TypeError);
  });

  it('Server initialization -- url object -- port out of range', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ { host: 's-west.divvy.com', port: 65537, secure: true } ]
        });
      }, Error);
  });

  it('Server initialization -- url string', function() {
    var remote = new Remote({
      servers: [ 'wss://s-west.divvy.com:443' ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'wss://s-west.divvy.com:443');
  });

  it('Server initialization -- url string -- ws://', function() {
    var remote = new Remote({
      servers: [ 'ws://s-west.divvy.com:443' ]
    });
    assert(Array.isArray(remote._servers));
    assert(remote._servers[0] instanceof Server);
    assert.strictEqual(remote._servers[0]._url, 'ws://s-west.divvy.com:443');
  });

  it('Server initialization -- url string -- invalid host', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ 'ws://+:443' ]
        });
      }, Error
    );
  });

  it('Server initialization -- url string -- invalid port', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ 'ws://s-west.divvy.com:null' ]
        });
      }, Error
    );
  });

  it('Server initialization -- url string -- port out of range', function() {
    assert.throws(
      function() {
        var remote = new Remote({
          servers: [ 'ws://s-west.divvy.com:65537:' ]
        });
      }, Error
    );
  });

  it('Server initialization -- set max_fee', function() {
    var remote = new Remote({
      max_fee: 10
    });
    assert.strictEqual(remote.max_fee, 10);

    remote = new Remote({
      max_fee: 1234567890
    });
    assert.strictEqual(remote.max_fee, 1234567890);
  });

  it('Server initialization -- set max_fee -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        max_fee: '1234567890'
      });
    });
  });

  it('Server initialization -- set trusted', function() {
    var remote = new Remote({ trusted: true });
    assert.strictEqual(remote.trusted, true);
  });
  it('Server initialization -- set trusted -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        trusted: '1234567890'
      });
    });
  });

  it('Server initialization -- set trace', function() {
    var remote = new Remote({ trace: true });
    assert.strictEqual(remote.trace, true);
  });
  it('Server initialization -- set trace -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        trace: '1234567890'
      });
    });
  });

  it('Server initialization -- set allow_partial_history', function() {
    var remote = new Remote({ allow_partial_history: true });
    assert.strictEqual(remote.allow_partial_history, true);
  });
  it('Server initialization -- set allow_partial_history -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        allow_partial_history: '1234567890'
      });
    });
  });

  it('Server initialization -- set max_attempts', function() {
    var remote = new Remote({ max_attempts: 10 });
    assert.strictEqual(remote.max_attempts, 10);
  });
  it('Server initialization -- set max_attempts -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        max_attempts: '1234567890'
      });
    });
  });

  it('Server initialization -- set fee_cushion', function() {
    var remote = new Remote({ fee_cushion: 1.3 });
    assert.strictEqual(remote.fee_cushion, 1.3);
  });
  it('Server initialization -- set fee_cushion -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        fee_cushion: '1234567890'
      });
    });
  });

  it('Server initialization -- set local_signing', function() {
    var remote = new Remote({ local_signing: false });
    assert.strictEqual(remote.local_signing, false);
  });
  it('Server initialization -- set local_signing -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        local_signing: '1234567890'
      });
    });
  });
  it('Server initialization -- set local_fee', function() {
    var remote = new Remote({ local_fee: false });
    assert.strictEqual(remote.local_fee, true);
    var remote = new Remote({ local_signing: false, local_fee: false });
    assert.strictEqual(remote.local_fee, false);
  });
  it('Server initialization -- set local_fee -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        local_signing: false,
        local_fee: '1234567890'
      });
    });
  });
  it('Server initialization -- set local_sequence', function() {
    var remote = new Remote({ local_sequence: false });
    assert.strictEqual(remote.local_sequence, true);
    var remote = new Remote({ local_signing: false, local_sequence: false });
    assert.strictEqual(remote.local_sequence, false);
  });
  it('Server initialization -- set local_sequence -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        local_signing: false,
        local_sequence: '1234567890'
      });
    });
  });

  it('Server initialization -- set canonical_signing', function() {
    var remote = new Remote({ canonical_signing: false });
    assert.strictEqual(remote.canonical_signing, false);
  });
  it('Server initialization -- set canonical_signing -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        canonical_signing: '1234567890'
      });
    });
  });

  it('Server initialization -- set submission_timeout', function() {
    var remote = new Remote({ submission_timeout: 10 });
    assert.strictEqual(remote.submission_timeout, 10);
  });
  it('Server initialization -- set submission_timeout -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        submission_timeout: '1234567890'
      });
    });
  });

  it('Server initialization -- set last_ledger_offset', function() {
    var remote = new Remote({ last_ledger_offset: 10 });
    assert.strictEqual(remote.last_ledger_offset, 10);
  });
  it('Server initialization -- set last_ledger_offset -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        last_ledger_offset: '1234567890'
      });
    });
  });

  it('Server initialization -- set servers', function() {
    var remote = new Remote({ servers: [ ] });
    assert.deepEqual(remote.servers, [ ]);
  });
  it('Server initialization -- set servers -- invalid', function() {
    assert.throws(function() {
      var remote = new Remote({
        servers: '1234567890'
      });
    });
  });

  it('Automatic transactions subscription', function(done) {
    var remote = new Remote(options);
    var i = 0;

    remote.request = function(request) {
      switch (++i) {
        case 1:
          assert.strictEqual(request.message.command, 'subscribe');
          break;
        case 2:
          assert.strictEqual(request.message.command, 'unsubscribe');
          done();
          break;
      }
      assert.deepEqual(request.message.streams, [ 'transactions' ]);
    };

    remote.on('transaction', function(){});
    remote.removeAllListeners('transaction');
  });

  it('Check is valid message', function() {
    assert(Remote.isValidMessage({ type: 'response' }));
    assert(!Remote.isValidMessage({ }));
    assert(!Remote.isValidMessage(''));
  });
  it('Check is valid ledger data', function() {
    assert(Remote.isValidLedgerData({
      fee_base: 10, fee_ref: 10,
      ledger_hash: LEDGER_HASH,
      ledger_index: 1, ledger_time: 1,
      reserve_base: 10, reserve_inc: 10
    }));
    assert(!Remote.isValidLedgerData({
      fee_base: 10, fee_ref: 10,
      ledger_hash: LEDGER_HASH,
      ledger_index: 1, ledger_time: 1,
      reserve_base: 10, reserve_inc: '10'
    }));
    assert(!Remote.isValidLedgerData({
      fee_base: 10, fee_ref: 10,
      ledger_hash: LEDGER_HASH, ledger_index: 1,
      reserve_base: 10, reserve_inc: 10
    }));
  });
  it('Check is valid load status', function() {
    assert(Remote.isValidLoadStatus({
      load_base: 10, load_factor: 10
    }));
    assert(!Remote.isValidLoadStatus({
      load_base: 10, load_factor: '10'
    }));
    assert(!Remote.isValidLoadStatus({
      load_base: 10
    }));
  });
  it('Check is validated', function() {
    assert(Remote.isValidated({ validated: true }));
    assert(!Remote.isValidated({ validated: false }));
    assert(!Remote.isValidated({ validated: 'true' }));
    assert(!Remote.isValidated({ }));
    assert(!Remote.isValidated(null));
  });

  it('Set state', function() {
    var i = 0;
    remote.on('state', function(state) {
      switch (++i) {
        case 1:
          assert.strictEqual(state, 'online');
          break;
        case 2:
          assert.strictEqual(state, 'offline');
          break;
      }
      assert.strictEqual(state, remote.state);
    });
    remote._setState('online');
    remote._setState('online');
    remote._setState('offline');
    remote._setState('offline');
    assert.strictEqual(i, 2);
  });

  it('Set trace', function() {
    remote.setTrace(true);
    assert.strictEqual(remote.trace, true);
    remote.setTrace();
    assert.strictEqual(remote.trace, true);
    remote.setTrace(false);
    assert.strictEqual(remote.trace, false);
  });

  it('Set server fatal', function() {
    remote.setServerFatal();
    assert.strictEqual(remote._server_fatal, true);
  });

  it('Add server', function() {
    var server = remote.addServer('wss://s1.divvy.com:443');
    assert(server instanceof Server);

    var i = 0;
    remote.once('connect', function() {
      assert.strictEqual(remote._connection_count, 1);
      ++i;
    });
    remote.once('disconnect', function() {
      assert.strictEqual(remote._connection_count, 0);
      ++i;
    });

    server.emit('connect');
    server.emit('disconnect');

    assert.strictEqual(i, 2, 'Remote did not receive all server events');
  });
  it('Add server -- primary server', function() {
    var server = remote.addServer({
      host: 's1.divvy.com',
      port: 443,
      secure: true,
      primary: true
    });

    assert(server instanceof Server);
    assert.strictEqual(remote._servers.length, 2);
    assert.strictEqual(remote._servers[1], server);

    var i = 0;
    remote.once('connect', function() {
      assert.strictEqual(remote._connection_count, 1);
      assert.strictEqual(remote._primary_server, server);
      remote.setPrimaryServer(remote._servers[0]);
      assert.strictEqual(server._primary, false);
      assert.strictEqual(remote._primary_server, remote._servers[0]);
      ++i;
    });

    server.emit('connect');

    assert.strictEqual(i, 1, 'Remote did not receive all server events');
  });

  it('Connect', function() {
    remote.addServer('wss://s1.divvy.com:443');

    var i = 0;
    remote._servers.forEach(function(s) {
      s.connect = function() { ++i };
    });

    remote.connect();

    assert.strictEqual(remote._should_connect, true);
    assert.strictEqual(i, 2, 'Did not attempt connect to all servers');
  });

  it('Connect -- with callback', function(done) {
    remote.addServer('wss://s1.divvy.com:443');

    var i = 0;
    remote._servers.forEach(function(s) {
      s.connect = function() { ++i };
    });

    remote.connect(done);

    assert.strictEqual(remote._should_connect, true);
    assert.strictEqual(i, 2, 'Did not attempt connect to all servers');

    remote._servers[0].emit('connect');
  });

  it('Connect -- no servers', function() {
    remote._servers = [ ];
    assert.throws(function() {
      remote.connect();
    });
  });

  it('Disconnect', function() {
    remote.addServer('wss://s1.divvy.com:443');

    var i = 0;
    remote._servers.forEach(function(s) {
      s.disconnect = function() { ++i };
      s.emit('connect');
    });

    remote.disconnect();

    assert.strictEqual(remote._should_connect, false);
    assert.strictEqual(i, 2, 'Did not attempt disconnect to all servers');
  });
  it('Disconnect -- with callback', function(done) {
    remote.addServer('wss://s1.divvy.com:443');

    var i = 0;
    remote._servers.forEach(function(s) {
      s.disconnect = function() { ++i };
      s.emit('connect');
    });

    remote.disconnect(done);

    assert.strictEqual(remote._should_connect, false);
    assert.strictEqual(i, 2, 'Did not attempt disconnect to all servers');

    remote._servers.forEach(function(s) {
      s.emit('disconnect');
    });
  });
  it('Disconnect -- unconnected', function(done) {
    remote.addServer('wss://s1.divvy.com:443');

    var i = 0;
    remote._servers.forEach(function(s) {
      s.disconnect = function() { ++i };
    });

    remote.disconnect(done);

    assert.strictEqual(i, 0, 'Should not attempt disconnect');
  });
  it('Disconnect -- no servers', function() {
    remote._servers = [ ];
    assert.throws(function() {
      remote.disconnect();
    });
  });

  it('Handle server message -- ledger', function() {
    var message = {
      type: 'ledgerClosed',
      fee_base: 10,
      fee_ref: 10,
      ledger_hash: 'F824560DD788E5E4B65F5843A6616872873EAB74AA759C73A992355FFDFC4237',
      ledger_index: 11368614,
      ledger_time: 475696280,
      reserve_base: 20000000,
      reserve_inc: 5000000,
      txn_count: 9,
      validated_ledgers: '32570-11368614'
    };

    remote.once('ledger_closed', function(l) {
      assert.deepEqual(l, message);
      assert.strictEqual(remote.getLedgerHash(), message.ledger_hash);
    });
    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
  });
  it('Handle server message -- ledger', function(done) {
    var message = {
      type: 'ledgerClosed',
      fee_base: 10,
      fee_ref: 10,
      ledger_hash: 'F824560DD788E5E4B65F5843A6616872873EAB74AA759C73A992355FFDFC4237',
      ledger_index: 11368614,
      ledger_time: 475696280,
      reserve_base: 20000000,
      reserve_inc: 5000000,
      txn_count: 9,
      validated_ledgers: '32570-11368614'
    };

    remote.once('ledger_closed', function(l) {
      assert.deepEqual(l, message);
      done();
    });
    remote._servers[0].emit('message', message);

    setImmediate(function() {
      remote._servers[0].emit('connect');
    });
  });
  it('Handle server message -- server status', function() {
    var message = {
      type: 'serverStatus',
      load_base: 256,
      load_factor: 256,
      server_status: 'full'
    };

    remote.once('server_status', function(l) {
      assert.deepEqual(l, message);
    });
    remote._servers[0].emit('message', message);
    remote._servers[0].emit('connect');
  });
  it('Handle server message -- transaction', function() {
    var message = require('./fixtures/transaction');

    remote.once('transaction', function(l) {
      assert.deepEqual(l, message);
    });
    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
  });
  it('Handle server message -- transaction -- duplicate hashes', function() {
    var message = require('./fixtures/transaction');
    var i = 0;

    remote.once('transaction', function(l) {
      assert.deepEqual(l, message);
      ++i;
    });

    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
    remote._servers[0].emit('message', message);
    remote._servers[0].emit('message', message);
    assert.strictEqual(i, 1);
  });
  it('Handle server message -- transaction -- with account notification', function() {
    var message = require('./fixtures/transaction');
    var i = 0;
    var account = remote.addAccount(message.transaction.Account);

    account.once('transaction', function(t) {
      assert.deepEqual(t, message);
      ++i;
    });

    remote.once('transaction', function(l) {
      assert.deepEqual(l, message);
      ++i;
    });

    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
    assert.strictEqual(i, 2);
  });
  it('Handle server message -- transaction proposed -- with account notification', function() {
    var message = require('./fixtures/transaction-proposed');
    var i = 0;
    var account = remote.addAccount(message.transaction.Account);

    account.once('transaction', function(t) {
      assert.deepEqual(t, message);
      ++i;
    });

    remote.once('transaction', function(l) {
      assert.deepEqual(l, message);
      ++i;
    });

    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
    assert.strictEqual(i, 2);
  });
  it('Handle server message -- transaction -- with orderbook notification', function() {
    var message = require('./fixtures/transaction-offercreate');
    var i = 0;
    var orderbook = remote.createOrderBook({
      currency_gets: 'USD',
      issuer_gets: 'rJy64aCJLP3vf8o3WPKn4iQKtfpjh6voAR',
      currency_pays: 'XDV'
    });

    orderbook._subscribed = true;
    orderbook.once('transaction', function(t) {
      assert.deepEqual(t.transaction, message.transaction);
      assert.deepEqual(t.meta, message.meta);
      ++i;
    });

    remote.once('transaction', function(l) {
      assert.deepEqual(l, message);
      ++i;
    });

    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);
    assert.strictEqual(i, 2);
  });
  it('Handle server message -- path find', function() {
    var message = require('./fixtures/pathfind');
    var i = 0;

    var amount = Amount.from_json(
      { currency: 'USD',
        issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
        value: '0.001' }
    );
    var path = new PathFind(remote,
      'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
      'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
      amount
    );

    path.once('update', function(p) {
      assert.deepEqual(p, message);
      ++i;
    });
    remote.once('path_find_all', function(p) {
      assert.deepEqual(p, message);
      ++i;
    });

    remote._cur_path_find = path;
    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', message);

    assert.strictEqual(i, 2);
  });
  it('Handle server message -- invalid message', function() {
    var message = require('./fixtures/pathfind');
    var i = 0;

    remote.on('error', function(err) { ++i; });
    remote._servers[0].emit('message', '1');
    remote._servers[0].emit('message', { });
    remote._servers[0].emit('message', { type: 'response' });
    remote._servers[0].emit('message', JSON.stringify({ type: 'response' }));

    assert.strictEqual(i, 2, 'Failed to receive all invalid message errors');
  });

  it('Get server', function() {
    var server = remote.addServer('wss://sasdf.divvy.com:443');

    remote.connect();
    remote._connected = true;
    remote._servers.forEach(function(s) {
      s._connected = true;
    });

    var message = {
      type: 'ledgerClosed',
      fee_base: 10,
      fee_ref: 10,
      ledger_hash: 'F824560DD788E5E4B65F5843A6616872873EAB74AA759C73A992355FFDFC4237',
      ledger_index: 1,
      ledger_time: 475696280,
      reserve_base: 20000000,
      reserve_inc: 5000000,
      txn_count: 9,
      validated_ledgers: '32570-11368614'
    };

    remote._servers[0].emit('message', message);
    assert.strictEqual(remote.getServer(), remote._servers[0]);

    message.ledger_index += 1;

    remote._servers[1].emit('message', message);
    assert.strictEqual(remote.getServer(), remote._servers[1]);
  });
  it('Get server -- no servers', function() {
    assert.strictEqual(new Remote().getServer(), null);
  });
  it('Get server -- no connected servers', function() {
    var server = remote.addServer('wss://sasdf.divvy.com:443');
    assert.strictEqual(remote._servers.length, 2);
    assert.strictEqual(remote.getServer(), null);
  });
  it('Get server -- primary server', function() {
    var server = remote.addServer({
      host: 'sasdf.divvy.com',
      port: 443,
      secure: true,
      primary: true
    });

    remote.connect();
    server._connected = true;

    assert.strictEqual(remote.getServer().getServerID(), server.getServerID());
  });

  it('Parse binary transaction', function() {
    var binaryTransaction = require('./fixtures/binary-transaction.json');

    var parsedSourceTag = Remote.parseBinaryTransaction(binaryTransaction.PaymentWithSourceTag.binary);
    assert.deepEqual(parsedSourceTag, binaryTransaction.PaymentWithSourceTag.parsed);

    var parsedMemosAndPaths = Remote.parseBinaryTransaction(binaryTransaction.PaymentWithMemosAndPaths.binary);
    assert.deepEqual(parsedMemosAndPaths, binaryTransaction.PaymentWithMemosAndPaths.parsed);

    var parsedPartialPayment = Remote.parseBinaryTransaction(binaryTransaction.PartialPayment.binary);
    assert.deepEqual(parsedPartialPayment, binaryTransaction.PartialPayment.parsed);

    var parsedOfferCreate = Remote.parseBinaryTransaction(binaryTransaction.OfferCreate.binary);
    assert.deepEqual(parsedOfferCreate, binaryTransaction.OfferCreate.parsed);

    var parsedPartialPaymentWithXDVDelieveredAmount = Remote.parseBinaryTransaction(binaryTransaction.PartialPaymentWithXDVDeliveredAmount.binary);
    assert.deepEqual(parsedPartialPaymentWithXDVDelieveredAmount, binaryTransaction.PartialPaymentWithXDVDeliveredAmount.parsed);
  });

  it('Parse binary account transaction', function() {
    var binaryAccountTransaction = require('./fixtures/binary-account-transaction.json');

    var parsed = Remote.parseBinaryAccountTransaction(binaryAccountTransaction.OfferCreate.binary);
    assert.deepEqual(parsed, binaryAccountTransaction.OfferCreate.parsed);

    var parsedPartialPayment = Remote.parseBinaryAccountTransaction(binaryAccountTransaction.PartialPayment.binary);
    assert.deepEqual(parsedPartialPayment, binaryAccountTransaction.PartialPayment.parsed);

    var parsedPayment = Remote.parseBinaryAccountTransaction(binaryAccountTransaction.Payment.binary);
    assert.deepEqual(parsedPayment, binaryAccountTransaction.Payment.parsed);
  });

  it('Parse binary ledger', function() {
    var binaryLedgerData = require('./fixtures/binary-ledger-data.json');

    var parsedAccountRoot = Remote.parseBinaryLedgerData(binaryLedgerData.AccountRoot.binary);
    assert.deepEqual(parsedAccountRoot, binaryLedgerData.AccountRoot.parsed);

    var parsedOffer = Remote.parseBinaryLedgerData(binaryLedgerData.Offer.binary);
    assert.deepEqual(parsedOffer, binaryLedgerData.Offer.parsed);

    var parsedDirectoryNode = Remote.parseBinaryLedgerData(binaryLedgerData.DirectoryNode.binary);
    assert.deepEqual(parsedDirectoryNode, binaryLedgerData.DirectoryNode.parsed);

    var parsedDivvyState = Remote.parseBinaryLedgerData(binaryLedgerData.DivvyState.binary);
    assert.deepEqual(parsedDivvyState, binaryLedgerData.DivvyState.parsed);
  });

  it('Prepare currency', function() {
    assert.deepEqual(Remote.prepareCurrencies({
      issuer: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      currency: 'USD',
      value: 1
    }), {
      issuer: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      currency: '0000000000000000000000005553440000000000'
    });
  });

  it('Get transaction fee', function() {
    remote._connected = true;
    remote._servers[0]._connected = true;
    assert.strictEqual(remote.feeTx(10).to_json(), '12');
    remote._servers = [ ];
    assert.throws(function() {
      remote.feeTx(10).to_json();
    });
  });
  it('Get transaction fee units', function() {
    remote._connected = true;
    remote._servers[0]._connected = true;
    assert.strictEqual(remote.feeTxUnit(), 1.2);
    remote._servers = [ ];
    assert.throws(function() {
      remote.feeTxUnit(10).to_json();
    });
  });
  it('Get reserve', function() {
    remote._connected = true;
    remote._servers[0]._connected = true;
    assert.strictEqual(remote.reserve(1).to_json(), 'NaN');
    remote._servers = [ ];
    assert.throws(function() {
      remote.reserve(10).to_json();
    });
  });

  it('Initiate request', function() {
    var request = remote.requestServerInfo();

    assert.deepEqual(request.message, {
      command: 'server_info',
      id: void(0)
    });

    var i =0;
    remote._connected = true;
    remote._servers[0]._connected = true;
    remote._servers[0]._request = function() { ++i; };
    remote.request(request);

    assert.strictEqual(i, 1, 'Did not initiate request');
  });
  it('Initiate request -- with request name', function() {
    var request = remote.request('server_info');

    assert.deepEqual(request.message, {
      command: 'server_info',
      id: void(0)
    });

    var i =0;
    remote._connected = true;
    remote._servers[0]._connected = true;
    remote._servers[0]._request = function() { ++i; };
    remote.request(request);

    assert.strictEqual(i, 1, 'Did not initiate request');
  });
  it('Initiate request -- with invalid request name', function() {
    assert.throws(function() {
      remote.request('server_infoz');
    });
  });
  it('Initiate request -- with invalid request', function() {
    assert.throws(function() {
      remote.request({ });
    });
    assert.throws(function() {
      remote.request({ command: 'server_info', id: 1 });
    });
  });
  it('Initiate request -- set non-existent servers', function() {
    var request = remote.requestServerInfo();
    request.setServer('wss://s-east.divvy.com:443');
    assert.strictEqual(request.server, null);
    assert.throws(function() {
      remote._connected = true;
      remote.request(request);
    });
  });

  it('Construct ledger request', function() {
    var request = remote.requestLedger();
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0)
    });
  });
  it('Construct ledger request -- with ledger index', function() {
    var request = remote.requestLedger({ ledger: 1 });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 1
    });
    request = remote.requestLedger({ ledger_index: 1 });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 1
    });
    request = remote.requestLedger(1);
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 1
    });
    request = remote.requestLedger(null);
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0)
    });
  });
  it('Construct ledger request -- with ledger hash', function() {
    var request = remote.requestLedger({ ledger: LEDGER_HASH });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_hash: LEDGER_HASH
    });
    var request = remote.requestLedger({ ledger_hash: LEDGER_HASH });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_hash: LEDGER_HASH
    });
    var request = remote.requestLedger(LEDGER_HASH);
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_hash: LEDGER_HASH
    });
  });
  it('Construct ledger request -- with ledger identifier', function() {
    var request = remote.requestLedger({ ledger: 'validated' });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 'validated'
    });
    request = remote.requestLedger({ ledger: 'current' });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 'current'
    });
    request = remote.requestLedger('validated');
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 'validated'
    });
    request = remote.requestLedger({ validated: true });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 'validated'
    });
  });
  it('Construct ledger request -- with transactions', function() {
    var request = remote.requestLedger({
      ledger: 'validated',
      transactions: true
    });
    assert.deepEqual(request.message, {
      command: 'ledger',
      id: void(0),
      ledger_index: 'validated',
      transactions: true
    });
  });

  it('Construct ledger_closed request', function() {
    var request = remote.requestLedgerClosed();
    assert.deepEqual(request.message, {
      command: 'ledger_closed',
      id: void(0),
    });
  });
  it('Construct ledger_header request', function() {
    var request = remote.requestLedgerHeader();
    assert.deepEqual(request.message, {
      command: 'ledger_header',
      id: void(0)
    });
  });
  it('Construct ledger_current request', function() {
    var request = remote.requestLedgerCurrent();
    assert.deepEqual(request.message, {
      command: 'ledger_current',
      id: void(0)
    });
  });

  it ('Construct ledger_data request -- with ledger hash', function() {
    var request = remote.requestLedgerData({
      ledger: LEDGER_HASH,
      limit: 5
    });

    assert.deepEqual(request.message, {
      command: 'ledger_data',
      id: undefined,
      binary: true,
      ledger_hash: LEDGER_HASH,
      limit: 5
    });
  });

  it ('Construct ledger_data request -- with ledger index', function() {
    var request = remote.requestLedgerData( {
      ledger: LEDGER_INDEX,
      limit: 5
    });

    assert.deepEqual(request.message, {
      command: 'ledger_data',
      id: undefined,
      binary: true,
      ledger_index: LEDGER_INDEX,
      limit: 5,
    });
  });

  it ('Construct ledger_data request -- no binary', function() {
    var request = remote.requestLedgerData( {
      ledger: LEDGER_HASH,
      limit: 5,
      binary: false
    });

    assert.deepEqual(request.message, {
      command: 'ledger_data',
      id: undefined,
      binary: false,
      ledger_hash: LEDGER_HASH,
      limit: 5,
    });
  });

  it('Construct server_info request', function() {
    var request = remote.requestServerInfo();
    assert.deepEqual(request.message, {
      command: 'server_info',
      id: void(0)
    });
  })

  it('Construct peers request', function() {
    var request = remote.requestPeers();
    assert.deepEqual(request.message, {
      command: 'peers',
      id: void(0)
    });
  });

  it('Construct connection request', function() {
    var request = remote.requestConnect('0.0.0.0', '443');
    assert.deepEqual(request.message, {
      command: 'connect',
      id: void(0),
      ip: '0.0.0.0',
      port: '443'
    });
  });

  it('Construct unl_add request', function() {
    var request = remote.requestUnlAdd('0.0.0.0');
    assert.deepEqual(request.message, {
      command: 'unl_add',
      node: '0.0.0.0',
      id: void(0)
    });
  });

  it('Construct unl_list request', function() {
    var request = remote.requestUnlList();
    assert.deepEqual(request.message, {
      command: 'unl_list',
      id: void(0)
    });
  });

  it('Construct unl_delete request', function() {
    var request = remote.requestUnlDelete('0.0.0.0');
    assert.deepEqual(request.message, {
      command: 'unl_delete',
      node: '0.0.0.0',
      id: void(0)
    });
  });

  it('Construct subscribe request', function() {
    var request = remote.requestSubscribe([ 'server', 'ledger' ]);
    assert.deepEqual(request.message, {
      command: 'subscribe',
      id: void(0),
      streams: [ 'server', 'ledger' ]
    });
  });
  it('Construct unsubscribe request', function() {
    var request = remote.requestUnsubscribe([ 'server', 'ledger' ]);
    assert.deepEqual(request.message, {
      command: 'unsubscribe',
      id: void(0),
      streams: [ 'server', 'ledger' ]
    });
  });

  it('Construct ping request', function() {
    var request = remote.requestPing();
    assert.deepEqual(request.message, {
      command: 'ping',
      id: void(0)
    });
  });
  it('Construct ping request -- with server', function() {
    var request = remote.requestPing('wss://s1.divvy.com:443');
    assert.strictEqual(request.server, remote._servers[0]);
    assert.deepEqual(request.message, {
      command: 'ping',
      id: void(0)
    });
  });

  it('Construct account_currencies request -- with ledger index', function() {
    var request = remote.requestAccountCurrencies({account: ADDRESS});
    assert.strictEqual(request.message.command, 'account_currencies');
    assert.strictEqual(request.message.account, ADDRESS);
  });

  it('Construct account_info request -- with ledger index', function() {
    var request = remote.requestAccountInfo({account: ADDRESS, ledger: 9592219});
    assert.strictEqual(request.message.command, 'account_info');
    assert.strictEqual(request.message.account, ADDRESS);
    assert.strictEqual(request.message.ledger_index, 9592219);
  });
  it('Construct account_info request -- with ledger hash', function() {
    var request = remote.requestAccountInfo({account: ADDRESS, ledger: LEDGER_HASH});
    assert.strictEqual(request.message.command, 'account_info');
    assert.strictEqual(request.message.account, ADDRESS);
    assert.strictEqual(request.message.ledger_hash, LEDGER_HASH);
  });
  it('Construct account_info request -- with ledger identifier', function() {
    var request = remote.requestAccountInfo({account: ADDRESS, ledger: 'validated'});
    assert.strictEqual(request.message.command, 'account_info');
    assert.strictEqual(request.message.account, ADDRESS);
    assert.strictEqual(request.message.ledger_index, 'validated');
  });

  it('Construct account balance request -- with ledger index', function() {
    var request = remote.requestAccountBalance({account:ADDRESS, ledger:9592219});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.account_root, ADDRESS);
    assert.strictEqual(request.message.ledger_index, 9592219);
  });
  it('Construct account balance request -- with ledger hash', function() {
    var request = remote.requestAccountBalance({account:ADDRESS, ledger:LEDGER_HASH});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.account_root, ADDRESS);
    assert.strictEqual(request.message.ledger_hash, LEDGER_HASH);
  });
  it('Construct account balance request -- with ledger identifier', function() {
    var request = remote.requestAccountBalance({account:ADDRESS, ledger:'validated'});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.account_root, ADDRESS);
    assert.strictEqual(request.message.ledger_index, 'validated');
  });

  it('Construct account flags request', function() {
    var request = remote.requestAccountFlags({account:ADDRESS});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.account_root, ADDRESS);
  });
  it('Construct account owner count request', function() {
    var request = remote.requestOwnerCount({account:ADDRESS});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.account_root, ADDRESS);
  });

  it('Construct account_lines request', function() {
    var request = remote.requestAccountLines({ account: ADDRESS });
    assert.deepEqual(request.message, {
      command: 'account_lines',
      id: undefined,
      account: ADDRESS
    });
  });
  it('Construct account_lines request -- with peer', function() {
    var request = remote.requestAccountLines({
      account: ADDRESS,
      peer: ADDRESS
    });
    assert.deepEqual(request.message, {
      command: 'account_lines',
      id: undefined,
      account: ADDRESS,
      peer: ADDRESS
    });
  });
  it('Construct account_lines request -- with limit', function() {
    var request = remote.requestAccountLines({account: ADDRESS, limit: 100});
    assert.deepEqual(request.message, {
      command: 'account_lines',
      id: undefined,
      account: ADDRESS,
      limit: 100
    });
  });
  it('Construct account_lines request -- with limit and marker', function() {
    var request = remote.requestAccountLines({
      account: ADDRESS, limit: 100, marker: PAGING_MARKER, ledger: 9592219
    });
    assert.deepEqual(request.message, {
      command: 'account_lines',
      id: undefined,
      account: ADDRESS,
      limit: 100,
      marker: PAGING_MARKER,
      ledger_index: 9592219
    });
  });
  it('Construct account_lines request -- with min limit', function() {
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: 0}).message.limit, 0);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: -1}).message.limit, 0);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: -1e9}).message.limit, 0);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: -1e24}).message.limit, 0);
  });
  it('Construct account_lines request -- with max limit', function() {
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: 1e9}).message.limit, 1e9);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: 1e9+1}).message.limit, 1e9);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: 1e10}).message.limit, 1e9);
    assert.strictEqual(remote.requestAccountLines({account: ADDRESS, limit: 1e24}).message.limit, 1e9);
  });
  it('Construct account_lines request -- with marker -- missing ledger', function() {
    assert.throws(function() {
      remote.requestAccountLines({account: ADDRESS, marker: PAGING_MARKER})
    },'A ledger_index or ledger_hash must be provided when using a marker');

    assert.throws(function() {
      remote.requestAccountLines({account: ADDRESS, marker: PAGING_MARKER, ledger:'validated'})
    },'A ledger_index or ledger_hash must be provided when using a marker');

    assert.throws(function() {
      remote.requestAccountLines({account: ADDRESS, marker: PAGING_MARKER, ledger:NaN})
    },'A ledger_index or ledger_hash must be provided when using a marker');

    assert.throws(function() {
      remote.requestAccountLines({account: ADDRESS, marker: PAGING_MARKER, ledger:LEDGER_HASH.substr(0,63)})
    },'A ledger_index or ledger_hash must be provided when using a marker');

    assert.throws(function() {
      remote.requestAccountLines({account: ADDRESS, marker: PAGING_MARKER, ledger:LEDGER_HASH+'F'})
    },'A ledger_index or ledger_hash must be provided when using a marker');
  });
  it('Construct account_lines request -- with callback', function() {
    var request = remote.requestAccountLines({
      account: ADDRESS,
    }, callback);

    assert.deepEqual(request.message, {
      command: 'account_lines',
      id: undefined,
      account: ADDRESS
    });
  });

  it ('Construct account_tx request', function() {
    var request = remote.requestAccountTransactions({
      account: UInt160.ACCOUNT_ONE,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 5,
      forward: true,
      marker: PAGING_MARKER
    });

    assert.deepEqual(request.message, {
      command: 'account_tx',
      id: undefined,
      account: UInt160.ACCOUNT_ONE,
      ledger_index_min: -1,
      ledger_index_max: -1,
      binary: true,
      forward: true,
      limit: 5,
      marker: PAGING_MARKER
    });

    var request = remote.requestAccountTransactions({
      account: UInt160.ACCOUNT_ONE,
      min_ledger: -1,
      max_ledger: -1
    });
    assert.deepEqual(request.message, {
      command: 'account_tx',
      id: undefined,
      account: UInt160.ACCOUNT_ONE,
      binary: true,
      ledger_index_min: -1,
      ledger_index_max: -1
    });
  });
  it ('Construct account_tx request -- no binary', function() {
    var request = remote.requestAccountTransactions({
      account: UInt160.ACCOUNT_ONE,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 5,
      forward: true,
      binary: false,
      marker: PAGING_MARKER
    });

    assert.deepEqual(request.message, {
      command: 'account_tx',
      id: undefined,
      account: UInt160.ACCOUNT_ONE,
      ledger_index_min: -1,
      ledger_index_max: -1,
      binary: false,
      forward: true,
      limit: 5,
      marker: PAGING_MARKER
    });
  });

  it ('Construct account_offers request -- no binary', function() {
    var request = remote.requestAccountOffers({ account: ADDRESS });
    assert.deepEqual(request.message, {
      command: 'account_offers',
      id: undefined,
      account: ADDRESS
    });
  });

  it('Construct offer request -- with ledger index', function() {
    var request = remote.requestOffer({ index: TRANSACTION_HASH, ledger: LEDGER_INDEX});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.offer, TRANSACTION_HASH);
    assert.strictEqual(request.message.ledger_index, LEDGER_INDEX);
  });
  it('Construct offer request -- with ledger index and sequence', function() {
    var request = remote.requestOffer({account: ADDRESS, ledger: LEDGER_INDEX, sequence: 5});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.offer.account, ADDRESS);
    assert.strictEqual(request.message.offer.seq, 5);
    assert.strictEqual(request.message.ledger_index, LEDGER_INDEX);
  });
  it('Construct offer request -- with ledger hash', function() {
    var request = remote.requestOffer({account: ADDRESS, ledger: LEDGER_HASH, sequence: 5});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.offer.account, ADDRESS);
    assert.strictEqual(request.message.offer.seq, 5);
    assert.strictEqual(request.message.ledger_hash, LEDGER_HASH);
  });
  it('Construct offer request -- with ledger identifier and sequence', function() {
    var request = remote.requestOffer({account: ADDRESS, ledger: 'validated', sequence: 5});
    assert.strictEqual(request.message.command, 'ledger_entry');
    assert.strictEqual(request.message.offer.account, ADDRESS);
    assert.strictEqual(request.message.offer.seq, 5);
    assert.strictEqual(request.message.ledger_index, 'validated');
  });

  it('Construct book_offers request', function() {
    var request = remote.requestBookOffers({
      taker_gets: {
        currency: 'USD',
        issuer: ADDRESS
      },
      taker_pays: {
        currency: 'XDV'
      }
    });

    assert.deepEqual(request.message, {
      command: 'book_offers',
      id: undefined,
      taker_gets: {
        currency: Currency.from_human('USD').to_hex(),
        issuer: ADDRESS
      },
      taker_pays: {
        currency: Currency.from_human('XDV').to_hex()
      },
      taker: UInt160.ACCOUNT_ONE
    });
  });

  it('Construct book_offers request -- with ledger and limit', function() {
    var request = remote.requestBookOffers({
      taker_gets: {
        currency: 'USD',
        issuer: ADDRESS
      },
      taker_pays: {
        currency: 'XDV'
      },
      ledger: LEDGER_HASH,
      limit: 10
    });

    assert.deepEqual(request.message, {
      command: 'book_offers',
      id: undefined,
      taker_gets: {
        currency: Currency.from_human('USD').to_hex(),
        issuer: ADDRESS
      },
      taker_pays: {
        currency: Currency.from_human('XDV').to_hex()
      },
      taker: UInt160.ACCOUNT_ONE,
      ledger_hash: LEDGER_HASH,
      limit: 10
    });
  });

  it ('Construct tx request', function() {
    var request = remote.requestTransaction({
      hash: TRANSACTION_HASH
    });

    assert.deepEqual(request.message, {
      command: 'tx',
      id: undefined,
      binary: true,
      transaction: TRANSACTION_HASH
    });
  });
  it ('Construct tx request -- no binary', function() {
    var request = remote.requestTransaction( {
      hash: TRANSACTION_HASH,
      binary: false
    });

    assert.deepEqual(request.message, {
      command: 'tx',
      id: undefined,
      binary: false,
      transaction: TRANSACTION_HASH
    });
  });

  it('Construct transaction_entry request', function() {
    var request = remote.requestTransactionEntry({
      hash: TRANSACTION_HASH
    });

    assert.deepEqual(request.message, {
      command: 'transaction_entry',
      id: undefined,
      tx_hash: TRANSACTION_HASH,
      ledger_index: 'validated'
    });
  });
  it('Construct transaction_entry request -- with ledger index', function() {
    var request = remote.requestTransactionEntry({
      hash: TRANSACTION_HASH,
      ledger: 1
    });

    assert.deepEqual(request.message, {
      command: 'transaction_entry',
      id: undefined,
      tx_hash: TRANSACTION_HASH,
      ledger_index: 1
    });
  });
  it('Construct transaction_entry request -- with ledger hash', function() {
    var request = remote.requestTransactionEntry({
      hash: TRANSACTION_HASH,
      ledger: LEDGER_HASH
    });

    assert.deepEqual(request.message, {
      command: 'transaction_entry',
      id: undefined,
      tx_hash: TRANSACTION_HASH,
      ledger_hash: LEDGER_HASH
    });
  });
  it('Construct transaction_entry request -- with invalid ledger', function() {
    assert.throws(function() {
      var request = remote.requestTransactionEntry({
        hash: TRANSACTION_HASH,
        ledger: {}
      });
    });
  });

  it('Construct tx_history request', function() {
    var request = remote.requestTransactionHistory({
      start: 1
    });

    assert.deepEqual(request.message, {
      command: 'tx_history',
      id: undefined,
      start: 1
    });
  });

  it('Construct wallet_accounts request', function() {
    var request = remote.requestWalletAccounts({
      seed: 'shmnpxY42DaoyNbNQDoGuymNT1T9U'
    });

    assert.deepEqual(request.message, {
      command: 'wallet_accounts',
      id: undefined,
      seed: 'shmnpxY42DaoyNbNQDoGuymNT1T9U'
    });
  });
  it('Construct wallet_accounts request -- untrusted', function() {
    remote.trusted = false;

    assert.throws(function() {
      var request = remote.requestWalletAccounts({
        seed: 'shmnpxY42DaoyNbNQDoGuymNT1T9U'
      });
    });
  });

  it('Construct sign request', function() {
    var request = remote.requestSign({
      secret: 'shmnpxY42DaoyNbNQDoGuymNT1T9U',
      tx_json: {
        Flags: 0,
        TransactionType: 'AccountSet',
        Account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8'
      }
    });

    assert.deepEqual(request.message, {
      command: 'sign',
      id: undefined,
      secret: 'shmnpxY42DaoyNbNQDoGuymNT1T9U',
      tx_json: {
        Flags: 0,
        TransactionType: 'AccountSet',
        Account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8'
      }
    });
  });
  it('Construct sign request -- untrusted', function() {
    remote.trusted = false;

    assert.throws(function() {
      var request = remote.requestSign({
        secret: 'shmnpxY42DaoyNbNQDoGuymNT1T9U',
        tx_json: {
          Flags: 0,
          TransactionType: 'AccountSet',
          Account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8'
        }
      });
    });
  });

  it('Construct submit request', function() {
    var request = remote.requestSubmit();
    assert.deepEqual(request.message, {
      command: 'submit',
      id: undefined
    });
  });

  it('Construct transaction', function() {
    var tx = remote.createTransaction('AccountSet', {
      account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8',
      flags: 0
    });
    assert(tx instanceof Transaction);
    assert.deepEqual(tx.tx_json, {
      Flags: 0,
      TransactionType: 'AccountSet',
      Account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8'
    });

    tx = remote.createTransaction();
    assert(tx instanceof Transaction);
    assert.deepEqual(tx.tx_json, {
      Flags: 0
    });
  });
  it('Construct transaction -- invalid type', function() {
    assert.throws(function() {
      var tx = remote.createTransaction('AccountSetz', {
        account: 'rwLZs9MUVv28XZdYXDk9uNRUpAh1c6jij8',
        flags: 0
      });
    });
  });

  it('Construct ledger_accept request', function() {
    remote._stand_alone = true;
    var request = remote.requestLedgerAccept();

    assert.deepEqual(request.message, {
      command: 'ledger_accept',
      id: void(0)
    });

    remote._servers[0].emit('connect');
    remote._servers[0].emit('message', {
      type: 'ledgerClosed',
      fee_base: 10,
      fee_ref: 10,
      ledger_hash: 'F824560DD788E5E4B65F5843A6616872873EAB74AA759C73A992355FFDFC4237',
      ledger_index: 11368614,
      ledger_time: 475696280,
      reserve_base: 20000000,
      reserve_inc: 5000000,
      txn_count: 9,
      validated_ledgers: '32570-11368614'
    });
  });
  it('Construct ledger_accept request -- not standalone', function() {
    assert.throws(function() {
      var request = remote.requestLedgerAccept();
    });
  });

  it('Construct divvy balance request', function() {
    var request = remote.requestDivvyBalance({
      account: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      issuer: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
      ledger: 1,
      currency: 'USD'
    });

    assert.deepEqual(request.message, {
      command: 'ledger_entry',
      id: void(0),
      divvy_state: {
        currency: 'USD',
        accounts: [
          'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
          'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6'
        ]
      },
      ledger_index: 1
    });
  });

  it('Construct divvy_path_find request', function() {
    var request = remote.requestDivvyPathFind({
      src_account: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      dst_account: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
      dst_amount: '1/USD/rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      src_currencies: [ { currency: 'BTC', issuer: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6' } ]
    });

    assert.deepEqual(request.message, {
      command: 'divvy_path_find',
      id: void(0),
      source_account: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      destination_account: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
      destination_amount: {
        value: '1',
        currency: 'USD',
        issuer: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54'
      },
      source_currencies: [{
        issuer: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
        currency: '0000000000000000000000004254430000000000'
      }]
    });
  });

  it('Construct path_find create request', function() {
    var request = remote.requestPathFindCreate({
      src_account: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      dst_account: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
      dst_amount: '1/USD/rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      src_currencies: [ { currency: 'BTC', issuer: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6' } ]
    });

    assert.deepEqual(request.message, {
      command: 'path_find',
      id: void(0),
      subcommand: 'create',
      source_account: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54',
      destination_account: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
      destination_amount: {
        value: '1',
        currency: 'USD',
        issuer: 'rGr9PjmVe7MqEXTSbd3njhgJc2s5vpHV54'
      },
      source_currencies: [{
        issuer: 'rwxBjBC9fPzyQ9GgPZw6YYLNeRTSx5c2W6',
        currency: '0000000000000000000000004254430000000000'
      }]
    });
  });

  it('Construct path_find close request', function() {
    var request = remote.requestPathFindClose();

    assert.deepEqual(request.message, {
      command: 'path_find',
      id: void(0),
      subcommand: 'close',
    });
  });
});
