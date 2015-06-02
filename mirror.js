/*
  The filesync script uses the WinSCP utility to mirror local project
  directories on remote servers.
*/

// I. Import libraries.

var async         = require ('async');
var child_process = require ('child_process');
var express       = require ('express');
var fs            = require ('fs');
var path          = require ('path');
var os            = require ('os');

// II. Set global variables.

var CONNECTION_STATUS_ERROR   = 'Error';
var CONNECTION_STATUS_STOPPED = 'Stopped';
var CONNECTION_STATUS_RUNNING = 'Running';

var CONFIG_FILE_PATH = 'mirror.json';
var WINSCP = 'WinSCP';
var CONNECTIONS = [];

// III. Create the User Interface.

var app = express ();
app.listen (3000);

// IV. Start the Mirroring Service.

(function () {
  // 1. Read the configuration file.
  fs.readFile (CONFIG_FILE_PATH, 'utf8',
    function (error, file) {
      if (error) { throw new error; }

      // 2. Parse the configuration file.
      var settings = JSON.parse (file);
      WINSCP = settings.winscp;
      CONNECTIONS = settings.connections;

      // 3. Start each connection.
      CONNECTIONS.forEach (startConnection);

      // 4. Start the user interface.
      startUI ();
  });
}) ();

// Handles GET requests for static files within the project directory.
app.use ('/', express.static (path.resolve ('./')));

/*
  Handles GET requests for /connections.
  This handler returns a JSON string representing
  the connections listed in CONNECTIONS. This
  information can be used by client applications to
  determine the status of these connections.
*/
app.get ('/connections',
  function (request, response) {
    var connections = [];
    CONNECTIONS.forEach (function (connection) {
      connections.push ({
        name:        connection.name,
        status:      connection.status,
        local_path:  connection.local_path,
        remote_path: connection.remote_path,
        remote_host: connection.remote_host,
        remote_user: connection.remote_user,
        filter:      connection.filter
      });
    });

    response.json (connections);
});

/*
  Handles GET requests for /start.
  This handler expects a single query parameter,
  name, finds the connection in CONNECTIONS that
  has the given name, and starts a WinSCP process
  to mirror the connection's local and remote
  directories.
*/
app.get ('/start',
  function (request, response) {
    var connectionName = request.query.name;
    var connection = getConnectionByName (connectionName);
    if (connection && connection.status != CONNECTION_STATUS_RUNNING) {
      startConnection (connection);
    }
    response.location ('/');
});

/*
  Handles GET requests for /stop.
  This handler expects a single query parameter,
  name, finds the connection in CONNECTIONS that
  has the given name, and stops the WinSCP process
  that is mirroring the connection's local and
  remote directories.
*/
app.get ('/stop',
  function (request, response) {
    var connectionName = request.query.name;
    var connection = getConnectionByName (connectionName);
    if (connection && connection.status === CONNECTION_STATUS_RUNNING) {
      stopConnection (connection);
    }
    response.location ('/');
});

/*
  getConnectionByName accepts a string that
  represents a name, finds the first connection in
  CONNECTIONS that has the given name, and returns
  the connection as a CONNECTION object. If none of
  the connections have the given name, this
  function returns null.
*/
function getConnectionByName (name) {
  for (var i = 0; i < CONNECTIONS.length; i ++) {
    var connection = CONNECTIONS [i];
    if (connection.name === name) {
      return connection;
    }
  }
  return null;
}

/*
*/
function startConnection (connection) {
  os.platform ().match (/windows/i) ?
    winscp_start (connection) :
    rsync_start (connection) ;
}

/*
*/
function stopConnection (connection) {
  os.platform ().match (/windows/i) ?
    winscp_stop (connection) :
    rsync_stop (connection) ;
}

/*
  Starts the User Interface within the default browser.
  Note this command only works under Windows.
*/
function startUI () {
  child_process.exec ('start http://localhost:3000');
}

/*
  winscp_start accepts a Connection object and
  starts a new WinSCP process to connect to the
  remote host and mirror the connection's local
  and remote directories. This function also
  updates the Connection object's status, and
  registers event handlers for the WinSCP process.
*/
function winscp_start (connection) {
  console.log ('Starting a connection to: ' + connection.name + ' ' + WINSCP);
  connection.status = CONNECTION_STATUS_RUNNING;
  connection.process = child_process.spawn (WINSCP, ['sftp://' + connection.remote_user + '@' + connection.remote_host, '/privatekey=' + connection.ppkpath, '/keepuptodate', connection.local_path, connection.remote_path, '/defaults']);
  connection.process.stdout.on ('data', function (data) { console.log ('[stdout] ' + data); });
  connection.process.stderr.on ('data', function (data) { console.log ('[stderr] ' + data); });
  connection.process.on ('close', function (code, signal) {
    console.log ('The connection to ' + connection.name + ' has ended. code: ' + JSON.stringify (code));
    code && code !== 0 ?
      connection.status = CONNECTION_STATUS_ERROR :
      connection.status = CONNECTION_STATUS_STOPPED ;
  });
}

/*
  rsync_start accepts a Connection object and uses
  Rsync to mirror the local path on the remote
  host.
*/
function rsync_start (connection) {
  console.log ('rsync_start: ' + connection.name);
  async.forever (
    function (next) {
      setTimeout (
        function () {
          if (connection.stop) {
            console.log ('The connection to ' + connection.name + ' has ended.');
            connection.stop = false;
            connection.status = CONNECTION_STATUS_STOPPED;
            return;
          }
          console.log ('Mirroring rsync: ' + connection.name);
          connection.stop = false;
          connection.status = CONNECTION_STATUS_RUNNING;
          var cmd = 'rsync --delete --verbose --recursive --filter="' + connection.filter + '" "' + connection.local_path + '" "' + connection.remote_user + '@' + connection.remote_host + ':' + connection.remote_path + '"';
          console.log ('cmd: "' + cmd + '"');
          child_process.exec (cmd,
            function (error, stdout, stderr) {
              console.log ('[stdout] ' + stdout);
              if (error) {
                console.log ('Error: ' + stderr);
                connection.status = CONNECTION_STATUS_ERROR;
                return;
              }
              next (null, connection);
          });
        },
        5000
      );
  });
}

/*
  winscp_stop accepts a Connection object and
  sends a TERM signal to the WinSCP process
  handling the connection.
*/
function winscp_stop (connection) {
  connection.process.kill ();
}

/*
*/
function rsync_stop (connection) {
  connection.stop = true;
}
