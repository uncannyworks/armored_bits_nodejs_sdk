var sdk = require("./sdk.js");

var configure_mech = null;
var commit_configuration_finished = null;
var inGame = false;

var assign_hooks = function() {
  sdk.on_message_received = function(code, message) {    
    if ( code == sdk.MESSAGE_CODES.ServerSlugGenericResponse ) {
      console.log("GENERIC: " + message.response + " " + message.error + " " + message.msgId);
    } else {
      console.log("Received: " + message_code_to_string(code));
    }
  }

  sdk.on_message_sent = function(bytes) {
    console.log("Sent: " + message_code_to_string(bytes[0]) + " Message Length: " + (bytes.length));
  }

  sdk.on_connection_start = function() {
    console.log('Connected... waiting for Configuration Phase Start.');
  }

  sdk.on_connection_closed = function() {
    console.log('Connection closed.');
  }

  sdk.on_connection_timeout = function() {
    console.log('Connection timeout.');
    sdk.kill_connection();
  }

  sdk.on_connection_end = function() {
    console.log('Connection end.');
  }

  sdk.on_connection_error = function(err) {
    console.log("Connection Error: " + err.message);
  }

  sdk.on_comm_message_received = function(message) {
    console.log(message.componentId);
    console.log(message.channel);
    console.log(message.message);
  }

  sdk.on_configuration_phase_start = function() {
    console.log("Configuration Phase Start...");

    // Torso
    // Our torso model supports 1 weapon.
    var weaponsArray = [];
    weaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Projectile Type A"));
    var torso_message = sdk.build_config_torso_message("Torso Type A", "TE003", "Armor Type A", weaponsArray, ["Counter Measure Type A"], "Actuator Type A");

    // Cockpit
    var cockpit_message = sdk.build_config_cockpit_message("Cockpit Type A", ["Computer Type A"], ["Sensor Type A"], ["Communication Type A"], "Armor Type A", ["Counter Measure Type A"]);

    // Arms
    var armsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 arms.
      // Our arms support 1 weapons each.
      var armWeaponsArray = [];
      armWeaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Projectile Type A"));
      armsArray.push(sdk.make_arm("Arm Type A", "Armor Type A", armWeaponsArray, ["Counter Measure Type A"], i + 1));
    }
    var arm_messages = sdk.build_config_arm_messages(armsArray);

    // Legs
    var legsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 legs.      
      legsArray.push(sdk.make_leg("Leg Type A", "Armor Type A", i + 1));
    }
    var leg_messages = sdk.build_config_leg_messages(legsArray);

    // Full Request
    var config_message = this.build_config_mech_request("Mech Type A", "Capacitor Type A", "Gyro Type A", "KYR011", torso_message, cockpit_message, arm_messages, leg_messages);

    sdk.commit_configuration(config_message);
  }

  sdk.on_configuration_commit_finished = function(responseCode, errorCode, errorString) {
    if (errorCode == sdk.ERROR_CODES.NONE) {
      sdk.configuration_complete(); // Tell the SDK to let the game server know we're done.
    } else {
      console.log("Error: " + errorString + " (" + errorCode + ")");
      sdk.use_default_configuration(); // There were errors, lets just use the default rather than risk starting with a broken War Machine.
    }
  }

  sdk.on_configuration_phase_end = function() {
    console.log("Configuration Phase Ended");
  }

  sdk.on_startup_phase_start = function() {
    console.log("Startup Phase Start");
  }

  sdk.on_startup_phase_end = function() {
    console.log("Startup Phase End");
  }

  sdk.on_game_phase_start = function() {
    console.log("Game Phase Start");
    inGame = true;
    query_wm();
  }

  sdk.on_game_phase_end = function() {
    console.log("Game Phase End");
    inGame = false;
  }
}

var qt;
var query_wm = function() {
  if (inGame) {
    qt = process.hrtime();
    sdk.query_war_machine(ai_logic);
  }
}

var shooting = false;
var ai_logic = function(mechState) {
  try {
    var diff = process.hrtime(qt);

    console.log('Request took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');
    qt = process.hrtime();

    sdk.set_speed(100);
    sdk.rotate_torso(0, 20, 100);
    var weapons = mechState.weapons;

    if (!shooting) {
      shooting = true;
      start_shooting(weapons[0], 500, 3000);    
      sdk.broadcast_comm_message(mechState.communications[0], 1, "Herro!", null);
    }

    sdk.rotate(1);

    diff = process.hrtime(qt);

    console.log('Logic took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');

  } catch(err) {
    console.log("ERROR: " + err.stack);
  }  
  query_wm();
}

var start_shooting = function(weapon, burst, delay) {
  sdk.fire_weapon(weapon);
  setTimeout(function() {
    stop_shooting(weapon, burst, delay);
  }, burst);  
}

var stop_shooting = function(weapon, burst, delay) {
  sdk.idle_weapon(weapon);
  setTimeout(function() {
    start_shooting(weapon, burst, delay);
  }, delay);
}

var message_code_to_string = function(code) {
  for (var i in sdk.MESSAGE_CODES) {
    if (sdk.MESSAGE_CODES[i] == code) {
      return i;
    }
  }
}

assign_hooks();

sdk.connect(4000, '127.0.0.1', 'username', 'password');

setTimeout(function() {
return process.exit(0);
}, 30000);
// Just run for a minute.
