var net = require("net");
var protobuf = require("protobufjs");

/**
 * Represents the AbSdk.
 * @constructor
 */
var AbSdk = function() {
  var self = this;

  /**
   * Message Queue to manage outgoing TCP writes.
  */
  var MessageQueue = function() {
    var head = null;
    var tail = null;

    this.pushMessage = function(message) {
      var node = {
        'next': null,
        'message': message
      };
      if (head == null) { // New list.
        head = node;
        tail = node;
        return;
      }
      if (tail != null) {
        tail.next = node;
        tail = node;
      }
    };

    this.popMessage = function() {
      if (head == null) return null;

      var ret = head;
      head = head.next;
      ret.next = null;
      return ret.message;
    };

    this.peekMessage = function() {
      if (head == null) return null;
      return head.message;
    };

    this.hasMessages = function() {
      return head != null;
    };
  };
  var messageQueue = new MessageQueue();
  var canSendMessage = true; // This flag lets us know when to flush the queue to the stream.

  /**
   * Message Codes.
   * @type {!Object.<string,number>}
   * @const
  */
  this.MESSAGE_CODES = {
    ServerStateMessage: 1,
    ServerWorldStateMessage: 2,
    SlugConfigureChassisRequest: 20,
    SlugConfigureCockpitRequest: 22,
    SlugConfigureTorsoRequest: 24,
    SlugConfigureArmsRequest: 26,
    SlugConfigureLegsRequest: 28,
    SlugConfigureDoneRequest: 30,
    SlugGetQueryWarMachineRequest: 50,
    SlugGetQueryWarMachineResponse: 51,
    SlugSetCommitArmCounterMeasureRequest: 60,
    SlugSetCommitArmWeaponRequest: 62,
    SlugSetCommitChassisRequest: 64,
    SlugSetCommitCockpitCommunicationRequest: 66,
    SlugSetCommitCockpitComputerRequest: 68,
    SlugSetCommitCockpitCounterMeasureRequest: 70,
    SlugSetCommitCockpitSensorRequest: 72,
    SlugSetCommitEngineRequest: 74,
    SlugSetCommitTorsoActuatorRequest: 76,
    SlugSetCommitTorsoCounterMeasureRequest: 78,
    SlugSetCommitTorsoWeaponRequest: 80,
    ServerSlugGenericResponse: 101,
    SlugActionLoginRequest: 102,
    SlugActionLoginResponse: 103
  }

  /**
   * Response Codes.
   * @type {!Object.<string,number>}
   * @const
  */
  this.RESPONSE_CODES = {
    NONE: 0
  }

  /**
   * Error Codes.
   * @type {!Object.<string,number>}
   * @const
  */
  this.ERROR_CODES = {
    NONE: 0,
    WrongState: 50,
    ActuatorNotFound: 100,
    AmmoNotFound: 101,
    ArmNotFound: 102,
    ArmNoIndex: 103,
    ArmNotConfigured: 104,
    ArmorNotFound: 105,
    CapacitorNotFound: 106,
    ChassisNotFound: 107,
    ChassisNotConfigured: 108,
    CockpitNotFound: 109,
    CockpitNotConfigured: 110,
    CommunicationNotFound: 111,
    CommunicationsOverLimit: 112,
    ComputerNotFound: 113,
    ComputersOverLimit: 114,
    CounterMeasureNotFound: 115,
    CounterMeasureOverLimit: 116,
    EngineNotFound: 117,
    GyroNotFound: 118,
    LegNotFound: 119,
    LegNoIndex: 120,
    LegNotConfigured: 121,
    OverChassisMaxWeight: 122,
    ProtocolMismatch: 123,
    ReactorNotFound: 124,
    SensorNotFound: 125,
    SensorOverLimit: 126,
    TorsoNotFound: 127,
    TorsoNotConfigured: 128,
    WeaponNotFound: 129,
    WeaponOverLimit: 130
  }

  /**
   * Server World Codes.
   * @type {!Object.<string,number>}
   * @const
  */
  this.WORLD_STATE_CODES = {
    Initializing: 1,
    ConfigurationPhase: 2,
    StartupPhase: 3,
    GamePhase: 4,
    GameOverPhase: 5
  }

  /**
   * Component states.
   * @type {!Object.<string,number>}
   * @const
  */
  this.COMPONENT_STATE = {
    Active: 1,
    Inactive: 2
  }

  /**
   * Weapon fire states.
   * @type {!Object.<string,number>}
   * @const
  */
  this.WEAPON_FIRE_STATE = {
    Idle: 1,
    Fire: 2,
    Reload: 3
  }

  var protobufBuilder = protobuf.loadProtoFile(__dirname + "/slug.proto");
  var client = null;
  var configMessages = {};
  var nextStep = null; // Function pointer to the next step in whatever workflow is being performed.
  var errorList = [];
  var currentWorldState = this.WORLD_STATE_CODES.Initializing;
  var queryWarMachineCallback = null;

  var enableLogging = false;

  var internalWarMachine;

  var error_code_to_string = function(code) {
    for (var i in self.ERROR_CODES) {
      if (self.ERROR_CODES[i] == code) {
        return i;
      }
    }
  }

  var build_message = function(code, message) {    
    var buff = new protobuf.ByteBuffer(0);
    if (message) {
      buff = message.encode();
      var len = buff.toArrayBuffer().byteLength;

      var messageLengthBytes = new ArrayBuffer(2); // an Int16 takes 2 bytes
      var view = new DataView(messageLengthBytes);
      view.setUint16(0, len, false); // byteOffset = 0; litteEndian = false
      var bb = protobuf.ByteBuffer.wrap(messageLengthBytes);
      buff.prepend(bb);

      var messageCode = new Uint8Array(1);
      messageCode[0] = code;
      bb = protobuf.ByteBuffer.wrap(messageCode);
      buff.prepend(bb);
    } else {
      var messageLengthBytes = new ArrayBuffer(2); // an Int16 takes 2 bytes
      var view = new DataView(messageLengthBytes);
      view.setUint16(0, 0, false); // byteOffset = 0; litteEndian = false
      var bb = protobuf.ByteBuffer.wrap(messageLengthBytes);
      buff.prepend(bb);

      var messageCode = new Uint8Array(1);
      messageCode[0] = code;
      bb = protobuf.ByteBuffer.wrap(messageCode);
      buff.prepend(bb);
    }

    return new Buffer(buff.toArrayBuffer());
  }

  var _send_message = function(message) {
    messageQueue.pushMessage(message);
  }

  var _next_message = function() {
    if (messageQueue.hasMessages()) {
      if(self.on_message_sent) self.on_message_sent(messageQueue.peekMessage());
      client.write(messageQueue.popMessage(), null, _next_message);
    } else
      setTimeout(_next_message, 0);
  }
  setTimeout(_next_message, 0);

  var _digest = function(byteArray) {
    switch (byteArray[0]) {
    case self.MESSAGE_CODES.ServerStateMessage:
      var Proto = protobufBuilder.build("ServerStateMessage");
      var message = Proto.decode(byteArray.slice(3));
      if (self.on_message_received) self.on_message_received(byteArray[0], message);
      break;
    case self.MESSAGE_CODES.ServerWorldStateMessage:
      var Proto = protobufBuilder.build("ServerWorldStateMessage");
      var message = Proto.decode(byteArray.slice(3));
      if (message.worldState == self.WORLD_STATE_CODES.ConfigurationPhase) {
        if (self.on_configuration_phase_start) self.on_configuration_phase_start();
      }
      if (message.worldState == self.WORLD_STATE_CODES.StartupPhase) {
        if (currentWorldState == self.WORLD_STATE_CODES.ConfigurationPhase) {
          configMessages = {}; // Clear Configuration Messages
          if (self.on_configuration_phase_end) self.on_configuration_phase_end();
          if (self.on_startup_phase_start) self.on_startup_phase_start();
        }
      }
      if (message.worldState == self.WORLD_STATE_CODES.GamePhase) {
        if (currentWorldState == self.WORLD_STATE_CODES.StartupPhase) {
          if (self.on_startup_phase_end) self.on_startup_phase_end();
          if (self.on_game_phase_start) self.on_game_phase_start();
        }
      }
      if (message.worldState == self.WORLD_STATE_CODES.GameOverPhase) {
        if (currentWorldState == self.WORLD_STATE_CODES.GamePhase) {
          if (self.on_game_phase_end) self.on_game_phase_end();
        }
      }

      currentWorldState = message.worldState;
      if (self.on_message_received) self.on_message_received(byteArray[0], message);
      break;
    case self.MESSAGE_CODES.SlugActionLoginResponse:
      currentWorldState = self.WORLD_STATE_CODES.Initializing;
      if (self.on_connection_start) self.on_connection_start();
      if (self.on_message_received) self.on_message_received(byteArray[0], {});
      break;

    case self.MESSAGE_CODES.ServerSlugGenericResponse:
      var Proto = protobufBuilder.build("ServerSlugGenericResponse");
      var message = Proto.decode(byteArray.slice(3));

      /* What we do with generic responses is determined by a combination of
       * the current world state and the last message sent.
       */
      switch (currentWorldState) {
      case self.WORLD_STATE_CODES.ConfigurationPhase:
        // We don't want to do anything if this response is for the Done message.
        if (message.msgId != self.MESSAGE_CODES.SlugConfigureDoneRequest) {
          if (message.error == self.ERROR_CODES.NONE) {
            if (nextStep) {
              nextStep()
            } else if (self.on_configuration_commit_finished) {
              self.on_configuration_commit_finished(errorList);
            }
          }
          if (message.error != self.ERROR_CODES.NONE) {
            errorList.push({
              'response_code': message.response,
              'error_code': message.error,
              'error_string': error_code_to_string(message.error)
            });
            if (nextStep) {
              nextStep();
            } else if (self.on_configuration_commit_finished) {
              self.on_configuration_commit_finished(errorList);
            }
          }
        } else {
          self.log("Configuration done message acknowledged.");
        }
        break;
      case self.WORLD_STATE_CODES.GamePhase:
        if (message.error != self.ERROR_CODES.NONE) {
          self.log("ERROR MID (" + message.msgId + ") -- " + error_code_to_string(message.error));
        }
        break;
      }
      if (self.on_message_received) self.on_message_received(byteArray[0], message);
      break;

    case self.MESSAGE_CODES.SlugGetQueryWarMachineResponse:
      var Proto = protobufBuilder.build("SlugGetQueryWarMachineResponse");
      var message = Proto.decode(byteArray.slice(3));
      internalWarMachine = message;
      if (queryWarMachineCallback) queryWarMachineCallback(message);
      if (self.on_message_received) self.on_message_received(byteArray[0], message);
      break;
    default:
      self.log("(WARN) Unrecognized Message: " + byteArray[0]);
      if (self.on_message_received) self.on_message_received(byteArray[0], {});
    }
  }

  var _authenticate = function(username, password) {
    var Proto = protobufBuilder.build("SlugActionLoginRequest");
    var authMessage = new Proto("gameid", "slugid", "UserName");

    var message = build_message(self.MESSAGE_CODES.SlugActionLoginRequest, authMessage);

    _send_message(message);
  }

  var _commit_chassis = function() {
    self.log("Committing Chassis");
    var message = build_message(self.MESSAGE_CODES.SlugConfigureChassisRequest, configMessages.SlugConfigureChassisRequest);
    nextStep = _commit_torso;

    _send_message(message);
  }

  var _commit_torso = function() {
    self.log("Committing Torso");
    var message = build_message(self.MESSAGE_CODES.SlugConfigureTorsoRequest, configMessages.SlugConfigureTorsoRequest);
    nextStep = _commit_cockpit;

    _send_message(message);
  }

  var _commit_cockpit = function() {
    self.log("Committing Cockpit");
    var message = build_message(self.MESSAGE_CODES.SlugConfigureCockpitRequest, configMessages.SlugConfigureCockpitRequest);
    nextStep = _commit_arms;

    _send_message(message);
  }

  var _commit_arms = function() {
    self.log("Committing Arms");
    var message = build_message(self.MESSAGE_CODES.SlugConfigureArmsRequest, configMessages.SlugConfigureArmsRequest);
    nextStep = _commit_legs;

    _send_message(message);
  }

  var _commit_legs = function() {
    self.log("Committing Legs");
    var message = build_message(self.MESSAGE_CODES.SlugConfigureLegsRequest, configMessages.SlugConfigureLegsRequest);
    nextStep = null;

    _send_message(message);
  }

  var _send_configuration_complete_message = function(sdk, useDefault) {
    var Proto = protobufBuilder.build("SlugConfigureDoneRequest");
    configMessages.SlugConfigureDoneRequest = new Proto(useDefault);
    if (useDefault) {
      self.log("Send configuration complete message. Using default war machine.");
    } else {
      self.log("Send configuration complete message.");
    }
    var message = build_message(self.MESSAGE_CODES.SlugConfigureDoneRequest, configMessages.SlugConfigureDoneRequest);
    nextStep = null;

    _send_message(message);
  }

  var _query_war_machine = function() {
    var message = build_message(self.MESSAGE_CODES.SlugGetQueryWarMachineRequest);
    _send_message(message);
  }

  /**
   * Triggers when the client receives ANY message.
   * Override with desired behavior.
   * @param {Number} code - the message code.
   * @param {Object} message - the message JSON.
   */
  this.on_message_received = function(code, message) {}

  /**
   * Triggers when the client sends ANY message.
   * Override with desired behavior.
   * @param {byte[]} message - the message JSON.
   */
  this.on_message_sent = function(message) {}

  /**
   * Triggers on authenticated connection.
   * Override with desired behavior.
   */
  this.on_connection_start = function() {};
  /**
   * Triggers on TCP connection close.
   * Override with desired behavior.
   */
  this.on_connection_closed = function() {};
  /**
   * Triggers on TCP connection timeout.
   * Override with desired behavior.
   */
  this.on_connection_timeout = function() {};
  /**
   * Triggers on TCP connection end.
   * Override with desired behavior.
   */
  this.on_connection_end = function() {};
  /**
   * Triggers on TCP connection error.
   * Override with desired behavior.
   * @param {Object} error - a 'net' module Error object.
   */
  this.on_connection_error = function(error) {};
  /**
   * Triggers on Configuration Phase Start
   * Override with desired behavior.
   */
  this.on_configuration_phase_start = function() {};
  /**
   * Triggers on Configuration Phase End
   * Override with desired behavior.
   */
  this.on_configuration_phase_end = function() {};
  /**
   * Triggers on Startup Phase Start
   * Override with desired behavior.
   */
  this.on_startup_phase_start = function() {};
  /**
   * Triggers on Startup Phase End
   * Override with desired behavior.
   */
  this.on_startup_phase_end = function() {};
  /**
   * Triggers on Game Phase Start
   * Override with desired behavior.
   */
  this.on_game_phase_start = function() {};
  /**
   * Triggers on Game Phase End
   * Override with desired behavior.
   */
  this.on_game_phase_end = function() {};

  /**
  * Triggers on Configuration Commit Finished.
  * Override with desired behavior.
  * @param {Object[]} errorsArray
  * @param {number} errorsArray[].response_code
  * @param {number} errorsArray[].error_code
  * @param {string} errorsArray[].error_string
  **/
  this.on_configuration_commit_finished = function(errorsArray) {};

  /**
   * Creates TCP Connection   
   * @param {String} port - Connection port.
   * @param {String} ip - Connection IP Address.
   * @param {String} username - Authentication User Name.
   * @param {String} password - Authentication Password.
   */
  this.connect = function(port, ip, username, password) {
    var sdk = this;

    client = new net.Socket();
    client.buffer = new Buffer([]);

    client.connect(port, ip, function(){
      client.setNoDelay(true);
    });

    client.on('data', function(data) {
      if (client.messageBuffer && client.messageBuffer.length > 0) {
        var t = new Buffer(data.length + client.messageBuffer.length);
        client.messageBuffer.copy(t, 0, 0, client.messageBuffer.length);
        data.copy(t, client.messageBuffer.length, 0, data.length);
        client.messageBuffer = t;
      } else {
        client.messageBuffer = data;
      }

      while (true) {
        // Is the messageBuffer too small to be any message?
        if (client.messageBuffer.length < 3) {
          console.log("DEBUG: MessageBuffer too small. Waiting for next data event.");
          return;
        }

        var len = client.messageBuffer.readUInt16BE(1);

        // Is the messageBuffer too small to contain the full body of the message?
        if (client.messageBuffer.length < 3 + len) {
          console.log("DEBUG: MessageBuffer contains incomplete message body. Waiting for next data event.");
          return;
        }

        var chunk = client.messageBuffer.slice(0, 3 + len);
        _digest(chunk);

        // Find next message position.
        var nextMessageStart = 3 + len;

        // Are we at the end of the buffer?
        if (nextMessageStart == client.messageBuffer.length) {
          client.messageBuffer = null;
          return;
        }

        // Step the Buffer
        var t = new Buffer(client.messageBuffer.length - nextMessageStart);
        client.messageBuffer.copy(t, 0, nextMessageStart, client.messageBuffer.length);
        client.messageBuffer = t;
      }
    });

    client.on('connect', function() {
      _authenticate(username, password);
    });

    client.on('close', function() {
      if (self.on_connection_closed) self.on_connection_closed();
    });

    client.on('end', function() {
      if (self.on_connection_end) self.on_connection_end();
    });

    client.on('error', function(err) {
      if (self.on_connection_error) self.on_connection_error(err);
    });

    client.on('timeout', function() {
      if (self.on_connection_timeout) self.on_connection_timeout();
    });
  }

  /**
   * Stores chassis configuration.
   * @param {String} chassisModel - Chassis model number.
   * @param {String} reactorModel - Reactor model number.
   * @param {String} gyroModel - Gyroscope model number.
   * @param {String} capacitorModel - Capacitor model number.
   */
  this.configure_chassis = function(chassisModel, reactorModel, gyroModel, capacitorModel) {
    var Proto = protobufBuilder.build("SlugConfigureChassisRequest");
    configMessages.SlugConfigureChassisRequest = new Proto(chassisModel, reactorModel, gyroModel, capacitorModel);
  }

  /**
   * Stores torso configuration.
   * @param {String} torsoModel - Torso model number.
   * @param {String} engineModel - Engine model number.
   * @param {String} armorModel - Armor model number.
   * @param {Object[]} weaponsArray - The weapons to attach to this torso.
   * @param {string} weaponsArray[].weaponModel - Model number of this weapon.
   * @param {string} weaponsArray[].capacitorModel - Capacitor Model number to attach to this weapon.
   * @param {String[]} counterMeasureModels - Counter measure model numbers.
   */
  this.configure_torso = function(torsoModel, engineModel, armorModel, weaponsArray, counterMeasureModels, actuatorModel) {
    var torso = protobufBuilder.build("SlugConfigureTorsoRequest");
    var weapon = protobufBuilder.build("SlugConfigureWeaponMessage");
    var protoWeapons = [];
    weaponsArray.forEach(function(val) {
      protoWeapons.push(new weapon(val.weaponModel, val.capacitorModel, val.ammoModel));
    });
    configMessages.SlugConfigureTorsoRequest = new torso(torsoModel, engineModel, armorModel, protoWeapons, counterMeasureModels, actuatorModel);
  }

  /**
   * Stores cockpit configuration.
   * @param {String} cockpitModel - Cockpit model number.
   * @param {String[]} computerModels - Computer model numbers.
   * @param {String[]} sensorModel - Sensor model numbers.   
   * @param {String[]} communicationModel - Communication model numbers.
   * @param {String} armorModel - Armor model number.
   * @param {String[]} counterMeasureModels - Counter measure model numbers.
   */
  this.configure_cockpit = function(cockpitModel, computerModels, sensorModels, communicationModels, armorModel, counterMeasureModels) {
    var cock = protobufBuilder.build("SlugConfigureCockpitRequest");
    configMessages.SlugConfigureCockpitRequest = new cock(cockpitModel, computerModels, sensorModels, communicationModels, armorModel, counterMeasureModels);
  }

  /**
   * Stores arms configuration.
   * @param {Object[]} armsArray - The arms to attach to this torso.
   * @param {string} armsArray[].armModel - Model number of this arm.
   * @param {string} armsArray[].armorModel - Model number of this arm's armor.
   * @param {Object[]} armsArray[].weapons - The weapons attached to this arm.
   * @param {string} armsArray[].weapons[].weaponModel - This weapon's model number.
   * @param {string} armsArray[].weapons[].capacitorModel - This weapon's capacitor model number.
   * @param {string[]} armsArray[].counterMeasureModels - The counter measure model numbers for this arm.
   * @param {number} armsArray[].armPosition - The hard point to attach this arm to.
   */
  this.configure_arms = function(armsArray) {
    var req = protobufBuilder.build("SlugConfigureArmsRequest");
    var arm = protobufBuilder.build("SlugConfigureArmMessage");
    var wep = protobufBuilder.build("SlugConfigureWeaponMessage");
    var protoArms = [];
    armsArray.forEach(function(a) {
      var protoWeapons = [];
      a.weapons.forEach(function(w) {
        protoWeapons.push(new wep(w.weaponModel, w.capacitorModel, w.ammoModel));
      });
      protoArms.push(new arm(a.armModel, a.armorModel, protoWeapons, a.counterMeasureModels, a.armPosition));
    });
    configMessages.SlugConfigureArmsRequest = new req(protoArms);
  }

  /**
   * Stores legs configuration.
   * @param {Object[]} legsArray - The legs to attach to this torso.
   * @param {string} legsArray[].legModel - Model number of this leg.
   * @param {string} legsArray[].armorModel - Model number of this leg's armor.   
   * @param {number} legsArray[].legPosition - The hard point to attach this leg to.
   */
  this.configure_legs = function(legsArray) {
    var req = protobufBuilder.build("SlugConfigureLegsRequest");
    var leg = protobufBuilder.build("SlugConfigureLegMessage");
    var protoLegs = [];
    legsArray.forEach(function(l) {
      protoLegs.push(new leg(l.legModel, l.armorModel, l.legPosition));
    });
    configMessages.SlugConfigureLegsRequest = new req(protoLegs);
  }

  /**
   * Commits configuration to server.
   */
  this.commit_configuration = function() {
    errorList = [];
    _commit_chassis(this); // This chains into the rest of the commits.    
  }

  /**
   * Sends the "configuration complete" message to the game server.
   */
  this.configuration_complete = function() {
    _send_configuration_complete_message(this, false);
  }

  /**
   * Sends the "configuration complete" message but reverts all configurations (if any were made).
   */
  this.use_default_configuration = function() {
    _send_configuration_complete_message(this, true);
  }

  /**
   * Sends a request for the war machine's current state.
   * @param {function} callback - Function that accepts json data representing the war machine's state.
   */
  this.query_war_machine = function(callback) {
    queryWarMachineCallback = callback;
    _query_war_machine(this);
  }

  /**
   * Kills the TCP Connection.
  **/
  this.kill_connection = function() {
    client.destroy();
    client = null;
  }

  /**
   * Logs a message.
  **/
  this.log = function(message) {
    if (enableLogging)
      console.log("SDK: " + message);
  }

  /**
   * Show SDK log messages in console.
  **/
  this.enable_logging = function() {
    enableLogging = true;
  }

  /**
   * Hide SDK log messages in console.
  **/
  this.disable_logging = function() {
    enableLogging = false;
  }

  /**
   * Shortcut to create a weapon object.
   * @param {String} weaponModel - Weapon model number.
   * @param {String} [capacitorModel] - Capacitor model number.   
   */
  this.make_weapon = function(weaponModel, capacitorModel, ammoModel) {
    if (capacitorModel)
      return {
        'weaponModel': weaponModel,
        'capacitorModel': capacitorModel,
        'ammoModel': ammoModel
      };
    return {
      'weaponModel': weaponModel,
      'capacitorModel': "",
      'ammoModel': ammoModel
    };
  }

  /**
   * Shortcut to create an arm object.
   * @param {String} armModel - Arm model number.
   * @param {String} armorModel - Armor model number.   
   * @param {Object[]} weaponList - The weapons attached to this arm.
   * @param {string} weaponList[].weaponModel - This weapon's model number.
   * @param {string} weaponList[].capacitorModel - This weapon's capacitor model number.
   * @param {String[]} counterMeasureModels - Counter measure model numbers.   
   * @param {number} armPosition - Hardpoint to attach arm to.
   */
  this.make_arm = function(armModel, armorModel, weaponList, counterMeasureModels, armPosition) {
    return {
      'armModel': armModel,
      'armorModel': armorModel,
      'weapons': weaponList,
      'counterMeasureModels': counterMeasureModels,
      'armPosition': armPosition
    };
  }

  /**
   * Shortcut to create a leg object.
   * @param {string} legModel - Leg model number.
   * @param {string} armorModel - Armor model number.
   * @param {number} legPosition - Hardpoint to attach leg to.
   */
  this.make_leg = function(legModel, armorModel, legPosition) {
    return {
      'legModel': legModel,
      'armorModel': armorModel,
      'legPosition': legPosition
    };
  }

  // TODO: Document
  this.extract_chassis_power = function(rawState) {
    var ret = 0;
    try {
      ret += rawState.reactor.output;
      if (rawState.capacitor) {
        ret += rawState.capacitor.chargeAmount;
      }
    } catch ( err ) {
      ret = 0;
    }
    return ret;
  }

  // TODO: Document
  this.extract_arm_weapons = function(armPosition, rawState) {
    var ret = [];
    try {
      var arm = null;
      for (var i = 0; i < rawState.arms.length; i++) {
        if (rawState.arms[i].index == armPosition) {
          arm = rawState.arms[i];
          break;
        }
      }
      ;
      if (arm) {
        arm.weapons.forEach(function(wep) {
          ret.push(wep);
        });
      }
    } catch ( err ) {
      this.log(err + " ArmPosition(" + armPosition + ")");
      return ret;
    }
    return ret;
  }

  // TODO: Document
  this.extract_torso_weapons = function(rawState) {
    var ret = [];
    try {
      rawState.torso.weapons.forEach(function(wep) {
        ret.push(wep);
      });
    } catch ( err ) {
      return ret;
    }
    return ret;
  }

  // TODO: Document
  this.toggle_torso_state = function(state) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoActuatorRequest");
    var p = new Proto(state, null, null, null, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoActuatorRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.set_torso_rotation = function(pitch, yaw, speed) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoActuatorRequest");
    var p = new Proto(null, null, pitch, yaw, speed);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoActuatorRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.recenter_torso = function(speed) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoActuatorRequest");
    var p = new Proto(null, true, null, null, speed);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoActuatorRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.fire_torso_weapon_start = function(weaponPosition) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoWeaponRequest");
    var p = new Proto(weaponPosition, null, this.WEAPON_FIRE_STATE.Fire);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.fire_torso_weapon_stop = function(weaponPosition) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoWeaponRequest");
    var p = new Proto(weaponPosition, null, this.WEAPON_FIRE_STATE.Idle);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.reload_torso_weapon = function(weaponPosition) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoWeaponRequest");
    var p = new Proto(weaponPosition, null, this.WEAPON_FIRE_STATE.Reload);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_torso_weapon_state = function(weaponPosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoWeaponRequest");
    var p = new Proto(weaponPosition, state, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_torso_counter_measure_state = function(counterMeasurePosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitTorsoCounterMeasureRequest");
    var p = new Proto(counterMeasurePosition, state);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitTorsoCounterMeasureRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.fire_arm_weapon_start = function(armPosition, weaponIndex) {
    var Proto = protobufBuilder.build("SlugSetCommitArmWeaponRequest");
    var p = new Proto(armPosition, weaponIndex, null, this.WEAPON_FIRE_STATE.Fire);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitArmWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.fire_arm_weapon_stop = function(armPosition, weaponIndex) {
    var Proto = protobufBuilder.build("SlugSetCommitArmWeaponRequest");
    var p = new Proto(armPosition, weaponIndex, null, this.WEAPON_FIRE_STATE.Idle);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitArmWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.reload_arm_weapon = function(armPosition, weaponIndex) {
    var Proto = protobufBuilder.build("SlugSetCommitArmWeaponRequest");
    var p = new Proto(armPosition, weaponIndex, null, this.WEAPON_FIRE_STATE.Reload);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitArmWeaponRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_arm_counter_measure_state = function(armPosition, counterMeasurePosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitArmCounterMeasureRequest");
    var p = new Proto(armPosition, counterMeasurePosition, state);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitArmCounterMeasureRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.set_acceleration = function(speed) {
    var Proto = protobufBuilder.build("SlugSetCommitEngineRequest");
    var p = new Proto(null, speed);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitEngineRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_engine_state = function(state) {
    var Proto = protobufBuilder.build("SlugSetCommitEngineRequest");
    var p = new Proto(state, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitEngineRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.set_rotation = function(angle) {
    var Proto = protobufBuilder.build("SlugSetCommitChassisRequest");
    var p = new Proto(null, angle);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitChassisRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_chassis_state = function(state) {
    var Proto = protobufBuilder.build("SlugSetCommitChassisRequest");
    var p = new Proto(state, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitChassisRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.send_comm = function(commPosition, channel, byteData) {
    var Proto = protobufBuilder.build("SlugSetCommitCockpitCommunicationRequest");
    var p = new Proto(commPosition, null, channel, byteData);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitCockpitCommunicationRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_comm_state = function(commPosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitCockpitCommunicationRequest");
    var p = new Proto(commPosition, state, null, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitCockpitCommunicationRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.set_computer_target_lock = function(computerPosition, targetIndex) {
    var Proto = protobufBuilder.build("SlugSetCommitCockpitComputerRequest");
    var p = new Proto(computerPosition, null, targetIndex);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitCockpitComputerRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_computer_state = function(computerPosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitCockpitComputerRequest");
    var p = new Proto(computerPosition, state, null);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitCockpitComputerRequest, p);
    _send_message(message);
  }

  // TODO: Document
  this.toggle_cockpit_sensor_state = function(sensorPosition, state) {
    var Proto = protobufBuilder.build("SlugSetCommitCockpitSensorRequest");
    var p = new Proto(sensorPosition, state);
    var message = build_message(this.MESSAGE_CODES.SlugSetCommitCockpitSensorRequest, p);
    _send_message(message);
  }
};

module.exports = new AbSdk();
