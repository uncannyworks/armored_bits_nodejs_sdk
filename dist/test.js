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

var query_wm = function() {
  if (inGame) {
    sdk.query_war_machine(ai_logic);
  }
}

var ai_logic = function(mechState) {
  try {

    sdk.get_chassis_total_power();
    sdk.rotate_torso(10, 10, 10);
    sdk.broadcast_comm_message(mechState.communications[0], 1, "HERRO!", null);
    sdk.lock_on_target(mechState.computers[0], 9999999);
    sdk.clear_targets(mechState.computers[0], [9999999]);
    sdk.clear_primary_target(mechState.computers[0]);
    sdk.clear_locked_target(mechState.computers[0]);
    sdk.activate_counter_measure(mechState.counterMeasures[0]);
    sdk.deactivate_counter_measure(mechState.counterMeasures[0]);
    sdk.set_speed(100);
    sdk.rotate(1);
    sdk.power_down(100);
    sdk.power_up(100);
    sdk.self_destruct(100);
    sdk.activate_sensor(mechState.sensors[0]);
    sdk.deactivate_sensor(mechState.sensors[0]);
    sdk.fire_weapon(mechState.weapons[0]);
    sdk.reload_weapon(mechState.weapons[0]);
    sdk.idle_weapon(mechState.weapons[0]);
  
  } catch(err) {
    console.log("ERROR: " + err.stack);
  }  
  query_wm();
}

var message_code_to_string = function(code) {
  for (var i in sdk.MESSAGE_CODES) {
    if (sdk.MESSAGE_CODES[i] == code) {
      return i;
    }
  }
  return "UNKNOWN (" + code + ")";
}

assign_hooks();

sdk.connect(4000, '127.0.0.1', 'username', 'password');

setTimeout(function() {
return process.exit(0);
}, 30000);
// Just run for a minute.
