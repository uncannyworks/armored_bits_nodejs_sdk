var sdk = require("./sdk.js");

var configure_mech = null;
var commit_configuration_finished = null;
var inGame = false;

var sent = 0;
var rec = 0;

var assign_hooks = function() {
  sdk.on_message_received = function(code, message){
    rec++;    
    console.log(code + " " + rec + "/" + sent + " ");
  }

  sdk.on_message_sent = function(bytes){
    sent++;
    console.log(bytes[0] + " " + rec + "/" + sent + " (" + (bytes.length - 3) + ")");
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

  sdk.on_configuration_phase_start = function() {
    console.log("Configuration Phase Start...");    
    
    // Chassis
    sdk.configure_chassis("Chassis Type A", "KYR011", "Gyro Type A", "Capacitor Type A");

    // Torso
    // Our torso model supports 1 weapon.
    var weaponsArray = [];
    weaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Ammo Type A"));
    sdk.configure_torso("Torso Type A", "TE003", "Armor Type A", weaponsArray, ["Counter Measure Type A"], "Actuator Type A");

    // Cockpit
    sdk.configure_cockpit("Cockpit Type A", ["Computer Type A"], ["Sensor Type A"], ["Communication Type A"], "Armor Type A", ["Counter Measure Type A"]);

    // Arms
    var armsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 arms.
      // Our arms support 1 weapons each.
      var armWeaponsArray = [];
      armWeaponsArray.push(sdk.make_weapon("Weapon Type A", "", "Ammo Type A"));
      armsArray.push(sdk.make_arm("Arm Type A", "Armor Type A", armWeaponsArray, ["Counter Measure Type A"], i + 1));
    }
    sdk.configure_arms(armsArray);

    // Legs
    var legsArray = [];
    for (var i = 0; i < 2; i++) { // Our chassis model only has 2 legs.      
      legsArray.push(sdk.make_leg("Leg Type A", "Armor Type A", i + 1));
    }
    sdk.configure_legs(legsArray);

    sdk.commit_configuration();
  }

  sdk.on_configuration_commit_finished = function(errorList) {
    if (errorList.length == 0) {
      sdk.configuration_complete(); // Tell the SDK to let the game server know we're done.
    } else {
      errorList.forEach(function(err, _index, _array) {
        console.log("Error: " + err.error_string + " (" + err.error_code + ")");
      });
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
  var diff = process.hrtime(qt);  

  console.log('Request took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');
  qt = process.hrtime();

  if(mechState.torso.engine.velocity < 10 && mechState.torso.engine.acceleration < 1) sdk.set_acceleration(mechState.torso.engine.accelerationMax);
  else if(mechState.torso.engine.velocity >= 10 && mechState.torso.engine.acceleration > 0) sdk.set_acceleration(0);  

  var chassisPower = sdk.extract_chassis_power(mechState); // Chassis Power includes capacitor power if installed.
  var torsoWeapons = sdk.extract_torso_weapons(mechState);

  // We have 2 arms.
  var arm1Weapons = sdk.extract_arm_weapons(1, mechState);
  var arm2Weapons = sdk.extract_arm_weapons(2, mechState);

  if(!shooting){
    shooting = true;    
    start_shooting_torso(torsoWeapons[0].index, 500, 3000);   
    start_shooting_arm(1, arm1Weapons[0].index, 500, 4000);
    start_shooting_arm(2, arm2Weapons[0].index, 500, 5000);
  }

  var mechs = [];
  for(var i=0; i < mechState.cockpit.sensors[0].activeTargets.length; i++){
    var t = mechState.cockpit.sensors[0].activeTargets[i];    
    if(t.targetId != 100){ // Ignore Self
      mechs.push({ id: t.targetId, vec: new THREE.Vector3(t.targetPosition.x, t.targetPosition.y, t.targetPosition.z) });
    }
  }

  sdk.set_rotation(1);

  diff = process.hrtime(qt);

  console.log('Logic took ' + ((diff[0] * 1e9 + diff[1]) / 1000000) + ' milliseconds');
}

start_shooting_torso = function(index, burst, delay){  
  sdk.fire_torso_weapon_start(index);
  setTimeout(function(){
    stop_shooting_torso(index, burst, delay);
  }, burst);
}

stop_shooting_torso = function(index, burst, delay){
  sdk.fire_torso_weapon_stop(index);
  setTimeout(function(){
    start_shooting_torso(index, burst, delay);
  }, delay);
}

start_shooting_arm = function(armIndex, wepIndex, burst, delay){  
  sdk.fire_arm_weapon_start(armIndex, wepIndex);
  setTimeout(function(){
    stop_shooting_arm(armIndex, wepIndex, burst, delay);
  }, burst);
}

stop_shooting_arm = function(armIndex, wepIndex, burst, delay){
  sdk.fire_arm_weapon_stop(armIndex, wepIndex);
  setTimeout(function(){
    start_shooting_arm(armIndex, wepIndex, burst, delay);
  }, delay);
}

assign_hooks();

sdk.connect(4000, '127.0.0.1', 'username', 'password');

var iid = setInterval(query_wm, 100);
setTimeout(function() {return process.exit(0);}, 30000);
// Just run for a minute.
