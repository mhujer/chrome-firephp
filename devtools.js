function Console() {
}

Console.Type = {
  LOG: "log",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  GROUP: "group",
  GROUP_COLLAPSED: "groupCollapsed",
  GROUP_END: "groupEnd"
};

Console.addMessage = function(type, format, args) {
  chrome.extension.sendRequest({
      command: "sendToConsole",
      tabId: chrome.experimental.devtools.tabId,
      args: escape(JSON.stringify(Array.prototype.slice.call(arguments, 0)))
  });
};

// Generate Console output methods, i.e. Console.log(), Console.debug() etc.
(function() {
  var console_types = Object.getOwnPropertyNames(Console.Type);
  for (var type = 0; type < console_types.length; ++type) {
    var method_name = Console.Type[console_types[type]];
    Console[method_name] = Console.addMessage.bind(Console, method_name);
  }
})();

function ChromeFirePHP() {
};

ChromeFirePHP.handleFirePhpHeaders = function(har_entry) {
  var response_headers = har_entry.response.headers;
  var wf_header_map = {};
  var had_wf_headers = false;

  for (var i = 0; i < response_headers.length; ++i) {
    var header = response_headers[i];
    if (/^X-Wf-/.test(header.name)) {
      wf_header_map[header.name] = header.value;
      had_wf_headers = true;
    }
  }

  var proto_header = wf_header_map["X-Wf-Protocol-1"];
  if (!had_wf_headers || !this._checkProtoVersion(proto_header))
    return;

  var message_objects = this._buildMessageObjects(wf_header_map);
  message_objects.sort(function(a, b) {
      var aFile = a.File || "";
      var bFile = b.File || "";
      if (aFile !== bFile)
        return aFile.localeCompare(bFile);
      var aLine = a.Line !== undefined ? a.Line : -1;
      var bLine = b.Line !== undefined ? b.Line : -1;
      return aLine - bLine;
  });

  var context = { pageRef: har_entry.pageref };
  for (var i = 0; i < message_objects.length; ++i)
    this._processLogMessage(message_objects[i], context);
  if (context.groupStarted)
    Console.groupEnd();
};

ChromeFirePHP._processLogMessage = function(message, context) {
  var meta = message[0];
  if (!meta) {
    Console.error("No Meta in FirePHP message");
    return;
  }

  var body = message[1];
  var type = meta.Type;
  if (!type) {
    Console.error("No Type for FirePHP message");
    return;
  }

  switch (type) {
    case "LOG":
    case "INFO":
    case "WARN":
    case "ERROR":
      if (!context.groupStarted) {
        context.groupStarted = true;
        Console.groupCollapsed(context.pageRef || "");
      }
      if (typeof(body) != 'object') {
        Console.addMessage(Console.Type[type], "%s%o",
          (meta.Label ? meta.Label + ": " : ""), body, "(in " + meta.File + ":" + meta.Line + ")");
      } else {
        Console.log("[" + " (in " + meta.File + ":" + meta.Line + ")");
        this._processLogMessageObject(body, 1);
        Console.log("]");
      }
      break;
    case "EXCEPTION":
    case "TABLE":
        Console.log((meta.Label ? meta.Label : ""));
        this._processTable(body);
      break;
    case "TRACE":
    case "GROUP_START":
    case "GROUP_END":
     // FIXME: implement
     break;
  }
};

/**
 * Process Object Log Message
 * @param level Level of the message
 */
ChromeFirePHP._processLogMessageObject = function(body, level)
{
    for (var ii in body) {
        if (typeof(body[ii]) == 'object') {
            level++;
            Console.log(this._padSpacesForLevel(level) + ii + " => [");
            this._processLogMessageObject(body[ii], level);
            Console.log(this._padSpacesForLevel(level) +"]");
        } else {
            text = "   " + ii + ' => "' + body[ii] + '"';
            Console.log(this._padSpacesForLevel(level) + text);
        }
    }
};

/**
 * It pads spaces for message indention
 */
ChromeFirePHP._padSpacesForLevel = function(level)
{
    var ret = "";
    for (i = 1; i < level; i++) {
        ret = ret + "   ";
    }
    return ret;
};

ChromeFirePHP._processTable = function(table)
{
	var columnsWidths = new Array();
	for (var rowId in table) {
		for (var columnId in table[rowId]) {
			if (table[rowId][columnId] == null) {
				table[rowId][columnId] = "";
			}
			if (typeof(table[rowId][columnId]) == 'object') {
				table[rowId][columnId] = this._convertObjectToInlineString(table[rowId][columnId], 1);
			}
			var length = table[rowId][columnId].length;
			if (typeof(columnsWidths[columnId]) == 'undefined' || length > columnsWidths[columnId]) {
				columnsWidths[columnId] = length;
			}
		}
	}

	for (var rowId in table) {
		var line = "";
		for (var columnId in table[rowId]) {
			line += table[rowId][columnId].rpad(' ', columnsWidths[columnId]);
			if (columnId < (table[rowId].length-1)) {
				line += " | ";
			}
		}
		Console.log("  " + line);
	}
};

ChromeFirePHP._convertObjectToInlineString = function(object, level)
{
	for (var ii in object) {
        if (typeof(object[ii]) == 'object') {
            level++;
            return ii + " => [" + this._convertObjectToInlineString(object[ii], level) + "]";
        } else {
            return "[" + ii + ' => "' + object[ii] + '"]';
        }
    }
};

//pads right @see http://sajjadhossain.com/2008/10/31/javascript-string-trimming-and-padding/
String.prototype.rpad = function(padString, length) {
	var str = this;
    while (str.length < length)
        str = str + padString;
    return str;
}

ChromeFirePHP._buildMessageObjects = function(header_map)
{
  const normal_header_prefix = "X-Wf-1-1-1-";

  return this._collectMessageObjectsForPrefix(header_map, normal_header_prefix);
};

ChromeFirePHP._collectMessageObjectsForPrefix = function(header_map, prefix) {
  var results = [];
  const header_regexp = /(?:\d+)?\|(.+)/;
  var json = "";
  for (var i = 1; ; ++i) {
    var name = prefix + i;
    var value = header_map[name];
    if (!value)
      break;

    var match = value.match(header_regexp);
    if (!match) {
      Console.error("Failed to parse FirePHP log message: " + value);
      break;
    }
    var json_part = match[1];
    json += json_part.substring(0, json_part.lastIndexOf("|"));
    if (json_part.charAt(json_part.length - 1) === "\\")
      continue;
    try {
      var message = JSON.parse(json);
      results.push(message);
    } catch(e) {
      Console.error("Failed to parse FirePHP log message: " + json);
    }
    json = "";
  }
  return results;
};

ChromeFirePHP._checkProtoVersion = function(proto_header) {
  if (!proto_header) {
    Console.warn("WildFire protocol header not found");
    return;
  }

  var match = /http:\/\/meta\.wildfirehq\.org\/Protocol\/([^\/]+)\/(.+)/.exec(
      proto_header);
  if (!match) {
    Console.warn("Invalid WildFire protocol header");
    return;
  }
  var proto_name = match[1];
  var proto_version = match[2];
  if (proto_name !== "JsonStream" || proto_version !== "0.2") {
    Console.warn(
        "Unknown FirePHP protocol version: %s (expecting JsonStream/0.2)",
        proto_name + "/" + proto_version);
    return false;
  }
  return true;
};

chrome.experimental.devtools.network.addRequestHeaders({
    "X-FirePHP-Version": "0.0.6"
});

chrome.experimental.devtools.network.getHAR(function(result) {
  var entries = result.entries;
  if (!entries.length) {
    Console.warn("ChromeFirePHP suggests that you reload the page to track" +
        " FirePHP messages for all the requests");
  }
  for (var i = 0; i < entries.length; ++i)
    ChromeFirePHP.handleFirePhp_headers(entries[i]);

  chrome.experimental.devtools.network.onRequestFinished.addListener(
      ChromeFirePHP.handleFirePhpHeaders.bind(ChromeFirePHP));
});
