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
    ServerCommunicationMessage: 5,
    ServerSlugOOBMessage: 6,
    SlugConfigureMechRequest: 20,
    SlugConfigureDoneRequest: 30,
    SlugQueryMechRequest: 50,
    SlugQueryMechResponse: 51,
    SlugCommitCounterMeasureRequest: 60,
    SlugCommitWeaponRequest: 62,
    SlugCommitMechRequest: 64,
    SlugCommitCommunicationRequest: 66,
    SlugCommitComputerRequest: 68,
    SlugCommitSensorRequest: 70,
    SlugCommitEngineRequest: 72,
    SlugCommitActuatorRequest: 74,
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
    Inactive: 2,
    NoPower: 3,
    Disabled: 4,
    Destroyed: 5
  }

  /**
   * Component location types.
   * @type {!Object.<string,number>}
   * @const
  */
  this.LOCATION_TYPE = {
    None: 0,
    Arm: 1,
    Cockpit: 2,
    Leg: 3,
    Torso: 4,
    Weapon: 5
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

  /**
   * Action codes for SlugCommitMechRequest
   * @type {!Object.<string,number>}
   * @const
  */
  this.MECH_REQUEST_ACTION = {
    Shutdown: 1,
    PowerUp: 2,
    SelfDestruct: 3
  }

  var protobufBuilder = protobuf.loadProtoFile(__dirname + "/slug.proto");
  var client = null;
  var currentWorldState = this.WORLD_STATE_CODES.Initializing;
  var queryWarMachineCallback = null;

  var enableLogging = false;

  var internalWarMachine;

  var _error_code_to_string = function(code) {
    for (var i in self.ERROR_CODES) {
      if (self.ERROR_CODES[i] == code) {
        return i;
      }
    }
  }

  var _message_code_to_string = function(code) {
    for (var i in self.MESSAGE_CODES) {
      if (self.MESSAGE_CODES[i] == code) {
        return i;
      }
    }
  }

  var _build_message = function(code, message) {
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
      if (self.on_message_sent) self.on_message_sent(messageQueue.peekMessage());
      client.write(messageQueue.popMessage(), null, _next_message);
    } else
      setTimeout(_next_message, 0);
  }
  setTimeout(_next_message, 0);

  var _digest = function(byteArray) {
    try {
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
        if (self.on_connection_start) self.on_connection_start();
        if (self.on_message_received) self.on_message_received(byteArray[0], {});
        break;

      case self.MESSAGE_CODES.ServerSlugGenericResponse:
        var Proto = protobufBuilder.build("ServerSlugGenericResponse");
        var message = Proto.decode(byteArray.slice(3));

        /* What we do with generic responses is determined by a combination of
         * the current world state and the request it is responding to.
         */
        switch (currentWorldState) {
        case self.WORLD_STATE_CODES.ConfigurationPhase:
          switch (message.msgId) {
          case self.MESSAGE_CODES.SlugConfigureDoneRequest:
            self.log("Configuration done message acknowledged.");
            break;

          case self.MESSAGE_CODES.SlugConfigureMechRequest:
            if (self.on_configuration_commit_finished) self.on_configuration_commit_finished(message.response, message.error, _error_code_to_string(message.error));
            break;
          }
        case self.WORLD_STATE_CODES.GamePhase:
          if (message.error != self.ERROR_CODES.NONE) {
            self.log("ERROR MID (" + message.msgId + ") -- " + _error_code_to_string(message.error));
          }
          break;
        }
        if (self.on_message_received) self.on_message_received(byteArray[0], message);
        break;

      case self.MESSAGE_CODES.SlugQueryMechResponse:
        var Proto = protobufBuilder.build("SlugQueryMechResponse");
        var message = Proto.decode(byteArray.slice(3));
        internalWarMachine = message;
        if (queryWarMachineCallback) queryWarMachineCallback(message);
        if (self.on_message_received) self.on_message_received(byteArray[0], message);
        break;

      case self.MESSAGE_CODES.ServerCommunicationMessage:
        var Proto = protobufBuilder.build("ServerCommunicationMessage");
        var message = Proto.decode(byteArray.slice(3));
        if (self.on_comm_message_received) self.on_comm_message_received(message);
        if (self.on_message_received) self.on_message_received(byteArray[0], message);
        break;

      case self.MESSAGE_CODES.ServerSlugOOBMessage:
        var Proto = protobufBuilder.build("ServerSlugOOBMessage");
        var message = Proto.decode(byteArray.slice(3));
        if (self.on_oob_received) self.on_oob_received(message);
        if (self.on_message_received) self.on_message_received(byteArray[0], message);
        break;

      default:
        self.log("(WARN) Unrecognized Message: " + byteArray[0]);
        if (self.on_message_received) self.on_message_received(byteArray[0], {});
      }
    } catch ( err ) {
      console.log(err)
    }
  }

  var _authenticate = function(username, password) {
    var Proto = protobufBuilder.build("SlugActionLoginRequest");
    var authMessage = new Proto("gameid", "slugid", "UserName");

    var message = _build_message(self.MESSAGE_CODES.SlugActionLoginRequest, authMessage);

    _send_message(message);
  }

  var _send_configuration_complete_message = function(sdk, useDefault) {
    var Proto = protobufBuilder.build("SlugConfigureDoneRequest");
    var configureDoneRequest = new Proto(useDefault);
    if (useDefault) {
      self.log("Send configuration complete message. Using default war machine.");
    } else {
      self.log("Send configuration complete message.");
    }
    var message = _build_message(self.MESSAGE_CODES.SlugConfigureDoneRequest, configureDoneRequest);

    _send_message(message);
  }

  var _query_war_machine = function() {
    var message = _build_message(self.MESSAGE_CODES.SlugQueryMechRequest);
    _send_message(message);
  }

  /**
   * Triggers when the client receives ANY message.
   * Override with desired behavior.
   * @param {number} code - the message code.
   * @param {object} message - the message JSON.
   */
  this.on_message_received = function(code, message) {}

  /**
   * Triggers when the client receives an Out of Bounds message.
   * Override with desired behavior.
   * @param {object} message - the message JSON.
   */
  this.on_oob_received = function(message) {}

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
  * @param {object[]} errorsArray
  * @param {number} errorsArray[].response_code
  * @param {number} errorsArray[].error_code
  * @param {string} errorsArray[].error_string
  **/
  this.on_configuration_commit_finished = function(errorsArray) {};

  /**
   * Triggers when the client receives broadcasted communications.
   * Override with desired behavior.
   * @param {object} message - An object with the following properties:
      componentId: the Int32 ID of the receiving component
      channel: the Int32 channel the communication came over
      message: the payload of the communication as a byte array
   */
  this.on_comm_message_received = function(message) {};

  /**
   * Creates TCP Connection
   * @param {string} port - Connection port.
   * @param {string} ip - Connection IP Address.
   * @param {string} username - Authentication User Name.
   * @param {string} password - Authentication Password.
   */
  this.connect = function(port, ip, username, password) {
    var sdk = this;

    client = new net.Socket();
    client.buffer = new Buffer([]);

    client.connect(port, ip, function() {
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
   * Builds mech configuration protobuf request.
   * @param {string} chassisModel - Chassis model number.
   * @param {string} capacitorModel - Capacitor model number. Use "" for none.
   * @param {string} gyroModel - Gyroscope model number.
   * @param {string} reactorModel - Reactor model number.
   * @param {object} configureTorsoMessage - Built with sdk.build_config_torso_message
   * @param {object} configureCockpitMessage - Built with sdk.build_config_cockpit_message
   * @param {object[]} configureArmMessages - Array of messages built with sdk.build_config_arm_messages
   * @param {object[]} configureLegMessages - Array of messages built with sdk.build_config_leg_messages
   * @returns {object} SlugConfigureMechRequest protobuf message
   */
  this.build_config_mech_request = function(chassisModel, capacitorModel, gyroModel, reactorModel, configureTorsoMessage, configureCockpitMessage, configureArmMessages, configureLegMessages) {
    var mech = protobufBuilder.build("SlugConfigureMechRequest");
    return new mech(chassisModel, capacitorModel, gyroModel, reactorModel, configureTorsoMessage, configureCockpitMessage, configureArmMessages, configureLegMessages);
  }

  /**
   * Builds torso configuration protobuf message.
   * @param {string} torsoModel - Torso model number.
   * @param {string} engineModel - Engine model number.
   * @param {string} armorModel - Armor model number.
   * @param {object[]} weaponsArray - The weapons to attach to this torso.
   * @param {string} weaponsArray[].weaponModel - Model number of this weapon.
   * @param {string} weaponsArray[].capacitorModel - Capacitor Model number to attach to this weapon.
   * @param {string[]} counterMeasureModels - Counter measure model numbers.
   * @returns {object} SlugConfigureTorsoMessage protobuf message
   */
  this.build_config_torso_message = function(torsoModel, engineModel, armorModel, weaponsArray, counterMeasureModels, actuatorModel) {
    var torso = protobufBuilder.build("SlugConfigureTorsoMessage");
    var weapon = protobufBuilder.build("SlugConfigureWeaponMessage");
    var protoWeapons = [];
    weaponsArray.forEach(function(val) {
      protoWeapons.push(new weapon(val.weaponModel, val.capacitorModel, val.ammoModel, val.weaponProtocol));
    });
    return new torso(torsoModel, engineModel, armorModel, protoWeapons, counterMeasureModels, actuatorModel);
  }

  /**
   * Builds cockpit configuration protobuf message.
   * @param {string} cockpitModel - Cockpit model number.
   * @param {string[]} computerModels - Computer model numbers.
   * @param {string[]} sensorModels - Sensor model numbers.
   * @param {string[]} communicationModels - Communication model numbers.
   * @param {string} armorModel - Armor model number.
   * @param {string[]} counterMeasureModels - Counter measure model numbers.
   * @returns {object} SlugConfigureCockpitMessage protobuf message
   */
  this.build_config_cockpit_message = function(cockpitModel, computerModels, sensorModels, communicationModels, armorModel, counterMeasureModels) {
    var cock = protobufBuilder.build("SlugConfigureCockpitMessage");
    return new cock(cockpitModel, computerModels, sensorModels, communicationModels, armorModel, counterMeasureModels);
  }

  /**
   * Builds array of arm configuration protobuf messages.
   * @param {object[]} armsArray - The arms to attach to this torso.
   * @param {string} armsArray[].armModel - Model number of this arm.
   * @param {string} armsArray[].armorModel - Model number of this arm's armor.
   * @param {object[]} armsArray[].weapons - The weapons attached to this arm.
   * @param {string} armsArray[].weapons[].weaponModel - This weapon's model number.
   * @param {string} armsArray[].weapons[].capacitorModel - This weapon's capacitor model number.
   * @param {string[]} armsArray[].counterMeasureModels - The counter measure model numbers for this arm.
   * @param {number} armsArray[].armPosition - The hard point to attach this arm to.
   * @returns {object[]} array of SlugConfigureArmMessage protobuf messages
   */
  this.build_config_arm_messages = function(armsArray) {
    var arm = protobufBuilder.build("SlugConfigureArmMessage");
    var wep = protobufBuilder.build("SlugConfigureWeaponMessage");
    var protoArms = [];
    armsArray.forEach(function(a) {
      var protoWeapons = [];
      a.weapons.forEach(function(w) {
        protoWeapons.push(new wep(w.weaponModel, w.capacitorModel, w.ammoModel, w.weaponProtocol));
      });
      protoArms.push(new arm(a.armModel, a.armorModel, protoWeapons, a.counterMeasureModels, a.armProtocol));
    });
    return protoArms;
  }

  /**
   * Builds array of leg configuration protobuf messages.
   * @param {object[]} legsArray - The legs to attach to this torso.
   * @param {string} legsArray[].legModel - Model number of this leg.
   * @param {string} legsArray[].armorModel - Model number of this leg's armor.
   * @returns {object[]} array of SlugConfigureLegMessage protobuf messages
   */
  this.build_config_leg_messages = function(legsArray) {
    var leg = protobufBuilder.build("SlugConfigureLegMessage");
    var protoLegs = [];
    legsArray.forEach(function(l) {
      protoLegs.push(new leg(l.legModel, l.legProtocol, l.armorModel));
    });
    return protoLegs;
  }

  /**
   * Commits configuration to server.
   */
  this.commit_configuration = function(configureMechRequest) {
    var message = _build_message(this.MESSAGE_CODES.SlugConfigureMechRequest, configureMechRequest);
    _send_message(message);
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
   * @param {string} weaponModel - Weapon model number.
   * @param {string} plugProtocol - Plug protocol this arms is going to use.
   * @param {string} [capacitorModel] - Capacitor model number.
   * @returns {object} - Weapon struct
   */
  this.make_weapon = function(weaponModel, plugProtocol, capacitorModel, ammoModel) {
    if (capacitorModel)
      return {
        'weaponModel': weaponModel,
        'capacitorModel': capacitorModel,
        'ammoModel': ammoModel,
        'weaponProtocol': plugProtocol
      };
    return {
      'weaponModel': weaponModel,
      'capacitorModel': "",
      'ammoModel': ammoModel,
      'weaponProtocol': plugProtocol
    };
  }

  /**
   * Shortcut to create an arm object.
   * @param {string} armModel - Arm model number.
   * @param {string} plugProtocol - Plug protocol this arms is going to use.
   * @param {string} armorModel - Armor model number.
   * @param {object[]} weaponList - The weapons attached to this arm.
   * @param {string} weaponList[].weaponModel - This weapon's model number.
   * @param {string} weaponList[].capacitorModel - This weapon's capacitor model number.
   * @param {string[]} counterMeasureModels - Counter measure model numbers.
   * @returns {object} - Arm struct
   */
  this.make_arm = function(armModel, plugProtocol, armorModel, weaponList, counterMeasureModels) {
    return {
      'armModel': armModel,
      'armorModel': armorModel,
      'weapons': weaponList,
      'counterMeasureModels': counterMeasureModels,
      'armProtocol': plugProtocol
    };
  }

  /**
   * Shortcut to create a leg object.
   * @param {string} legModel - Leg model number.
   * @param {string} plugProtocol - Plug protocol this arms is going to use.
   * @param {string} armorModel - Armor model number.
   * @returns {object} - Leg struct
   */
  this.make_leg = function(legModel, plugProtocol, armorModel) {
    return {
      'legModel': legModel,
      'armorModel': armorModel,
      'legProtocol': plugProtocol
    };
  }

  /**
   * @param {object} rawState - The war machine json structure obtained through sdk.query_war_machine
   * @returns {number} - Total power available from general capacitors and reactor, excludes weapon capacitors.
  **/
  this.get_chassis_total_power = function(warMachineStruct) {
    if(warMachineStruct == null) {
      if(null == internalWarMachine) {
        self.log("(ERROR) No cached War Machine. Please use sdk.query_war_machine first");
        return;
      }
      warMachineStruct = internalWarMachine;
    }
    var ret = warMachineStruct.reactor.output;
    for (var i = 0; i < warMachineStruct.capacitors.length; i++) {
      if(warMachineStruct.capacitors[i].location.locationType != "weapon")
        ret += warMachineStruct.capacitors[i].chargeAmount;
    }
    return ret;
  }

  /**
   * @param {number} locationType - int32 - sdk.LOCATION_TYPE
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {?number} state - int32 - sdk.COMPONENT_STATE
   * @param {?number} rotateX - float in degrees
   * @param {?number} rotateY - float in degrees
   * @param {?number} speed - float in degrees
   */
  this.send_actuator_request = function(locationType, locationId, positionId, state, rotateX, rotateY, speed) {
    var p = protobufBuilder.build("SlugCommitActuatorRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state, rotateX, rotateY, speed);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitActuatorRequest, m);
    _send_message(mg);
  }

  /**
   * TODO: Document
   **/
  this.rotate_actuator = function(actuatorStruct, xAngle, yAngle, speed){
    this.send_actuator_request(actuatorStruct.location.locationType,
      actuatorStruct.location.locationId,
      actuatorStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      xAngle,
      yAngle,
      speed
    );
  }

  /**
   * TODO: Document
   **/
  this.rotate_torso = function(xAngle, yAngle, speed, warMachineStruct){
    if(warMachineStruct == null) {
      if(null == internalWarMachine) {
        self.log("(ERROR) No cached War Machine. Please use sdk.query_war_machine first");
        return;
      }
      warMachineStruct = internalWarMachine;
    }
    var ta = null;
    var i = 0;
    do {
      ta = warMachineStruct.actuators[i++];
    } while (i < warMachineStruct.actuators.length && ta.location.locationType != this.LOCATION_TYPE.Torso);

    this.rotate_actuator(ta, xAngle, yAngle, speed);
  }

  /**
   * @param {number} locationType - int32 - sdk.LOCATION_TYPE
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {?number} state - int32 - sdk.COMPONENT_STATE
   * @param {?number} channelNumber - int32
   * @param {?byte[]} channelData
   * @param {?number} targetUser - int32
   **/
  this.send_communication_request = function(locationType, locationId, positionId, state, channelNumber, channelData, targetUser) {
    var p = protobufBuilder.build("SlugCommitCommunicationRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state, channelNumber, channelData, targetUser);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitCommunicationRequest, m);
    _send_message(mg);
  }

  /**
   * TODO: Document
   **/
  this.broadcast_comm_message = function(commStruct, channelNumber, data, targetId){
    this.send_communication_request(commStruct.location.locationType,
      commStruct.location.locationId,
      commStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      channelNumber,
      data,
      targetId
    );
  }

  /**
   * @param {number} locationType - int32 - sdk.LOCATION_TYPE
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {?number} state - int32 - sdk.COMPONENT_STATE
   * @param {?number} target - int32
   * @param {?number[]} clearTargets - int32
   * @param {?boolean} clearPrimary
   * @param {?boolean} clearLocked
   **/
  this.send_computer_request = function(locationType, locationId, positionId, state, target, clearTargets, clearPrimary, clearLocked) {
    var p = protobufBuilder.build("SlugCommitComputerRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state, target, clearTargets, clearPrimary, clearLocked);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitComputerRequest, m);
    _send_message(mg);
  }

  // TODO: Document
  this.lock_on_target = function(computerStruct, targetId){
    this.send_computer_request(computerStruct.location.locationType,
      computerStruct.location.locationId,
      computerStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      targetId,
      null,
      null,
      null
    );
  }

  // TODO: Document
  this.clear_targets = function(computerStruct, targetIdList){
    this.send_computer_request(computerStruct.location.locationType,
      computerStruct.location.locationId,
      computerStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      null,
      targetIdList,
      false,
      false
    );
  }

  // TODO: Document
  this.clear_primary_target = function(computerStruct){
    this.send_computer_request(computerStruct.location.locationType,
      computerStruct.location.locationId,
      computerStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      null,
      null,
      true,
      false
    );
  }

  // TODO: Document
  this.clear_locked_target = function(computerStruct){
    this.send_computer_request(computerStruct.location.locationType,
      computerStruct.location.locationId,
      computerStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      null,
      null,
      false,
      true
    );
  }

  /**
   * @param {number} locationType - int32 - sdk.LOCATION_TYPE
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {number} state - int32 - sdk.COMPONENT_STATE
   **/
  this.send_counter_measure_request = function(locationType, locationId, positionId, state) {
    var p = protobufBuilder.build("SlugCommitCounterMeasureRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitCounterMeasureRequest, m);
    _send_message(mg);
  }

  // TODO: Document
  this.activate_counter_measure = function(counterMeasureStruct){
    this.send_counter_measure_request(counterMeasureStruct.location.locationType,
      counterMeasureStruct.location.locationId,
      counterMeasureStruct.location.positionId,
      this.COMPONENT_STATE.Active)
  }

  // TODO: Document
  this.deactivate_counter_measure = function(counterMeasureStruct){
    this.send_counter_measure_request(counterMeasureStruct.location.locationType,
      counterMeasureStruct.location.locationId,
      counterMeasureStruct.location.positionId,
      this.COMPONENT_STATE.Inactive)
  }

  /**
   * @param {?number} state - sdk.COMPONENT_STATE
   * @param {?number} velocity - target velocity
   **/
  this.send_engine_request = function(state, velocity) {
    var p = protobufBuilder.build("SlugCommitEngineRequest");
    var m = new p(state, velocity);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitEngineRequest, m);
    _send_message(mg);
  }

  /**
   * TODO: Document
   **/
  this.set_speed = function(speed){
    this.send_engine_request(null, speed);
  }

  /**
   * @param {?number} rotation - float in degrees
   * @param {?number} action - int32 sdk.MECH_REQUEST_ACTION
   * @param {?number} delay - floating point time in seconds before "action" is performed
   **/
  this.send_mech_request = function(rotation, action, delay) {
    var p = protobufBuilder.build("SlugCommitMechRequest");
    var m = new p(action, delay, rotation);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitMechRequest, m);
    _send_message(mg);
  }

  /**
   * TODO: Document
   **/
  this.rotate = function(angle){
    this.send_mech_request(angle, null, null);
  }

  /**
   * TODO: Document
   **/
  this.power_down = function(delay){
    this.send_mech_request(null, this.MECH_REQUEST_ACTION.Shutdown, delay);
  }

  /**
   * TODO: Document
   **/
  this.power_up = function(delay){
    this.send_mech_request(null, this.MECH_REQUEST_ACTION.PowerUp, delay);
  }

  /**
   * TODO: Document
   **/
  this.self_destruct = function(delay){
    this.send_mech_request(null, this.MECH_REQUEST_ACTION.SelfDestruct, delay);
  }

  /**
   * @param {number} locationType - int32
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {?number} state - int32 - sdk.COMPONENT_STATE
   **/
  this.send_sensor_request = function(locationType, locationId, positionId, state) {
    var p = protobufBuilder.build("SlugCommitSensorRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitSensorRequest, m);
    _send_message(mg);
  }

  // TODO: Document
  this.activate_sensor = function(sensorStruct){
    this.send_sensor_request(sensorStruct.location.locationType,
      sensorStruct.location.locationId,
      sensorStruct.location.positionId,
      this.COMPONENT_STATE.Active)
  }

  // TODO: Document
  this.deactivate_sensor = function(sensorStruct){
    this.send_sensor_request(sensorStruct.location.locationType,
      sensorStruct.location.locationId,
      sensorStruct.location.positionId,
      this.COMPONENT_STATE.Inactive)
  }

  /**
   * @param {number} locationType - int32 - sdk.LOCATION_TYPE
   * @param {number} locationId - int32
   * @param {number} positionId - int32
   * @param {?number} state - int32 - sdk.COMPONENT_STATE
   * @param {?number} fireState - int32 - sdk.WEAPON_FIRE_STATE
   **/
  this.send_weapon_request = function(locationType, locationId, positionId, state, fireState) {
    var p = protobufBuilder.build("SlugCommitWeaponRequest");
    var l = protobufBuilder.build("SlugQueryLocationMessage");
    var loc = new l(locationType, locationId, positionId, 0);
    var m = new p(loc, state, fireState);
    var mg = _build_message(this.MESSAGE_CODES.SlugCommitWeaponRequest, m);
    _send_message(mg);
  }

  /**
   * TODO: Document
  **/
  this.fire_weapon = function(weaponStruct) {
    this.send_weapon_request(weaponStruct.location.locationType,
      weaponStruct.location.locationId,
      weaponStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      this.WEAPON_FIRE_STATE.Fire
    );
  }

  /**
   * TODO: Document
  **/
  this.idle_weapon = function(weaponStruct) {
    this.send_weapon_request(weaponStruct.location.locationType,
      weaponStruct.location.locationId,
      weaponStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      this.WEAPON_FIRE_STATE.Idle
    );
  }

  /**
   * TODO: Document
   **/
  this.reload_weapon = function(weaponStruct) {
    this.send_weapon_request(weaponStruct.location.locationType,
      weaponStruct.location.locationId,
      weaponStruct.location.positionId,
      this.COMPONENT_STATE.Active,
      this.WEAPON_FIRE_STATE.Reload
    );
  }
};

module.exports = new AbSdk();
