(function(global_scope) {
  var debug = false;
  // default timeout is 10 seconds, test can override if needed
  var settings = {
    output: true,
    harness_timeout: {
      normal: 10000,
      long: 60000
    },
    test_timeout: null,
    message_events: ["start", "test_state", "result", "completion"]
  };
  /*
     * TestEnvironment is an abstraction for the environment in which the test
     * harness is used. Each implementation of a test environment has to provide
     * the following interface:
     *
     * interface TestEnvironment {
     *   // Invoked after the global 'tests' object has been created and it's
     *   // safe to call add_*_callback() to register event handlers.
     *   void on_tests_ready();
     *
     *   // Invoked after setup() has been called to notify the test environment
     *   // of changes to the test harness properties.
     *   void on_new_harness_properties(object properties);
     *
     *   // Should return a new unique default test name.
     *   DOMString next_default_test_name();
     *
     *   // Should return the test harness timeout duration in milliseconds.
     *   float test_timeout();
     * };
     */

  /*
     * A test environment with a DOM. The global object is 'window'. By default
     * test results are displayed in a table. Any parent windows receive
     * callbacks or messages via postMessage() when test events occur. See
     * apisample11.html and apisample12.html.
     */
  function WindowTestEnvironment() {
    this.name_counter = 0;
    this.window_cache = null;
    this.output_handler = null;
    this.all_loaded = false;
    var this_obj = this;
    this.message_events = [];
    this.dispatched_messages = [];

    this.message_functions = {
      start: [
        add_start_callback,
        remove_start_callback,
        function(properties) {
          this_obj._dispatch("start_callback", [properties], {
            type: "start",
            properties: properties
          });
        }
      ],

      test_state: [
        add_test_state_callback,
        remove_test_state_callback,
        function(test) {
          this_obj._dispatch("test_state_callback", [test], {
            type: "test_state",
            test: {}
          });
        }
      ],
      result: [
        add_result_callback,
        remove_result_callback,
        function(test) {
          this_obj._dispatch("result_callback", [test], {
            type: "result",
            test: {}
          });
        }
      ],
      completion: [
        add_completion_callback,
        remove_completion_callback,
        function(tests, harness_status) {
          this_obj._dispatch("completion_callback", [tests, harness_status], {
            type: "complete",
            tests: [],
            status: ""
          });
        }
      ]
    };

    on_event(window, "load", function() {
      this_obj.all_loaded = true;
    });

    on_event(window, "message", function(event) {
      if (event.data && event.data.type === "getmessages" && event.source) {
        // A window can post "getmessages" to receive a duplicate of every
        // message posted by this environment so far. This allows subscribers
        // from fetch_tests_from_window to 'catch up' to the current state of
        // this environment.
        for (var i = 0; i < this_obj.dispatched_messages.length; ++i) {
          event.source.postMessage(this_obj.dispatched_messages[i], "*");
        }
      }
    });
  }

  WindowTestEnvironment.prototype._dispatch = function(
    selector,
    callback_args,
    message_arg
  ) {
    this.dispatched_messages.push(message_arg);
    this._forEach_windows(function(w, same_origin) {
      if (same_origin) {
        try {
          var has_selector = selector in w;
        } catch (e) {
          // If document.domain was set at some point same_origin can be
          // wrong and the above will fail.
          has_selector = false;
        }
        if (has_selector) {
          try {
            w[selector].apply(undefined, callback_args);
          } catch (e) {
            if (debug) {
              throw e;
            }
          }
        }
      }
      if (supports_post_message(w) && w !== self) {
        w.postMessage(message_arg, "*");
      }
    });
  };

  WindowTestEnvironment.prototype._forEach_windows = function(callback) {
    // Iterate of the the windows [self ... top, opener]. The callback is passed
    // two objects, the first one is the windows object itself, the second one
    // is a boolean indicating whether or not its on the same origin as the
    // current window.
    var cache = this.window_cache;
    if (!cache) {
      cache = [[self, true]];
      var w = self;
      var i = 0;
      var so;
      while (w != w.parent) {
        w = w.parent;
        so = is_same_origin(w);
        cache.push([w, so]);
        i++;
      }
      w = window.opener;
      if (w) {
        cache.push([w, is_same_origin(w)]);
      }
      this.window_cache = cache;
    }

    forEach(cache, function(a) {
      callback.apply(null, a);
    });
  };

  WindowTestEnvironment.prototype.on_tests_ready = function() {
    //var output = new Output();
    // this.output_handler = output;
    // var this_obj = this;
    // add_start_callback(function(properties) {
    //   this_obj.output_handler.init(properties);
    // });
    // add_test_state_callback(function(test) {
    //   this_obj.output_handler.show_status();
    // });
    // add_result_callback(function(test) {
    //   this_obj.output_handler.show_status();
    // });
    // add_completion_callback(function(tests, harness_status) {
    //   this_obj.output_handler.show_results(tests, harness_status);
    // });
    this.setup_messages(settings.message_events);
    add_completion_callback(function() {
      console.log(
        `All tests actual values:`,
        format_value(tests.tests_actual_results)
      );
      //console.warn(tests.status.message);
    });
  };

  WindowTestEnvironment.prototype.setup_messages = function(new_events) {
    var this_obj = this;
    forEach(settings.message_events, function(x) {
      var current_dispatch = this_obj.message_events.indexOf(x) !== -1;
      var new_dispatch = new_events.indexOf(x) !== -1;
      if (!current_dispatch && new_dispatch) {
        this_obj.message_functions[x][0](this_obj.message_functions[x][2]);
      } else if (current_dispatch && !new_dispatch) {
        this_obj.message_functions[x][1](this_obj.message_functions[x][2]);
      }
    });
    this.message_events = new_events;
  };

  WindowTestEnvironment.prototype.next_default_test_name = function() {
    //Don't use document.title to work around an Opera bug in XHTML documents
    var title = document.getElementsByTagName("title")[0];
    var prefix =
      (title && title.firstChild && title.firstChild.data) || "Untitled";
    var suffix = this.name_counter > 0 ? " " + this.name_counter : "";
    this.name_counter++;
    return prefix + suffix;
  };

  WindowTestEnvironment.prototype.on_new_harness_properties = function(
    properties
  ) {
    this.output_handler.setup(properties);
    if (properties.hasOwnProperty("message_events")) {
      this.setup_messages(properties.message_events);
    }
  };

  WindowTestEnvironment.prototype.add_on_loaded_callback = function(callback) {
    on_event(window, "load", callback);
  };

  WindowTestEnvironment.prototype.test_timeout = function() {
    var metas = document.getElementsByTagName("meta");
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].name == "timeout") {
        if (metas[i].content == "long") {
          return settings.harness_timeout.long;
        }
        break;
      }
    }
    return settings.harness_timeout.normal;
  };

  function create_test_environment() {
    if ("document" in global_scope) {
      return new WindowTestEnvironment();
    }

    throw new Error("Unsupported test environment");
  }

  var test_environment = create_test_environment();
  /*
   * API functions
   */

  function test(func, name, properties) {
    var test_name = name ? name : test_environment.next_default_test_name();
    properties = properties ? properties : {};
    var test_obj = new Test(test_name, properties);
    test_obj.step(func, test_obj, test_obj);
    if (test_obj.phase === test_obj.phases.STARTED) {
      test_obj.done();
    }
  }

  function async_test(func, name, properties) {
    if (typeof func !== "function") {
      properties = name;
      name = func;
      func = null;
    }
    var test_name = name ? name : test_environment.next_default_test_name();
    properties = properties ? properties : {};
    var test_obj = new Test(test_name, properties);
    if (func) {
      test_obj.step(func, test_obj, test_obj);
    }
    return test_obj;
  }

  function promise_test(func, name, properties) {
    var test = async_test(name, properties);
    // If there is no promise tests queue make one.
    if (!tests.promise_tests) {
      tests.promise_tests = Promise.resolve();
    }
    tests.promise_tests = tests.promise_tests.then(function() {
      var donePromise = new Promise(function(resolve) {
        test._add_cleanup(resolve);
      });
      var promise = test.step(func, test, test);
      test.step(function() {
        assert_not_equals(promise, undefined);
      });
      Promise.resolve(promise)
        .then(function() {
          test.done();
        })
        .catch(
          test.step_func(function(value) {
            if (value instanceof AssertionError) {
              throw value;
            }
            assert(
              false,
              "promise_test",
              null,
              "Unhandled rejection with value: ${value}",
              { value: value }
            );
          })
        );
      return donePromise;
    });
  }

  function promise_rejects(test, expected, promise, description) {}

  /**
   * This constructor helper allows DOM events to be handled using Promises,
   * which can make it a lot easier to test a very specific series of events,
   * including ensuring that unexpected events are not fired at any point.
   */
  function EventWatcher(test, watchedNode, eventTypes) {
    this.wait_for = function(types, options) {};

    return this;
  }

  expose(EventWatcher, "EventWatcher");

  function setup(func_or_properties, maybe_properties) {}

  function done() {}

  function generate_tests(func, args, properties) {}

  function on_event(object, event, callback) {}

  function step_timeout(f, t) {}

  expose(test, "test");
  expose(async_test, "async_test");
  expose(promise_test, "promise_test");
  expose(promise_rejects, "promise_rejects");
  expose(generate_tests, "generate_tests");
  expose(setup, "setup");
  expose(done, "done");
  expose(on_event, "on_event");
  expose(step_timeout, "step_timeout");

  /*
     * Return a string truncated to the given length, with ... added at the end
     * if it was longer.
     */
  function truncate(s, len) {
    if (s.length > len) {
      return s.substring(0, len - 3) + "...";
    }
    return s;
  }

  /*
     * Return true if object is probably a Node object.
     */
  function is_node(object) {
    // I use duck-typing instead of instanceof, because
    // instanceof doesn't work if the node is from another window (like an
    // iframe's contentWindow):
    // http://www.w3.org/Bugs/Public/show_bug.cgi?id=12295
    try {
      var has_node_properties =
        "nodeType" in object &&
        "nodeName" in object &&
        "nodeValue" in object &&
        "childNodes" in object;
    } catch (e) {
      // We're probably cross-origin, which means we aren't a node
      return false;
    }

    if (has_node_properties) {
      try {
        object.nodeType;
      } catch (e) {
        // The object is probably Node.prototype or another prototype
        // object that inherits from it, and not a Node instance.
        return false;
      }
      return true;
    }
    return false;
  }

  var replacements = {
    "0": "0",
    "1": "x01",
    "2": "x02",
    "3": "x03",
    "4": "x04",
    "5": "x05",
    "6": "x06",
    "7": "x07",
    "8": "b",
    "9": "t",
    "10": "n",
    "11": "v",
    "12": "f",
    "13": "r",
    "14": "x0e",
    "15": "x0f",
    "16": "x10",
    "17": "x11",
    "18": "x12",
    "19": "x13",
    "20": "x14",
    "21": "x15",
    "22": "x16",
    "23": "x17",
    "24": "x18",
    "25": "x19",
    "26": "x1a",
    "27": "x1b",
    "28": "x1c",
    "29": "x1d",
    "30": "x1e",
    "31": "x1f",
    "0xfffd": "ufffd",
    "0xfffe": "ufffe",
    "0xffff": "uffff"
  };

  /*
     * Convert a value to a nice, human-readable string
     */
  function format_value(val, seen) {
    if (!seen) {
      seen = [];
    }
    if (typeof val === "object" && val !== null) {
      if (seen.indexOf(val) >= 0) {
        return "[...]";
      }
      seen.push(val);
    }
    if (Array.isArray(val)) {
      return (
        "[" +
        val
          .map(function(x) {
            return format_value(x, seen);
          })
          .join(", ") +
        "]"
      );
    }

    switch (typeof val) {
      case "string":
        val = val.replace("\\", "\\\\");
        for (var p in replacements) {
          var replace = "\\" + replacements[p];
          val = val.replace(RegExp(String.fromCharCode(p), "g"), replace);
        }
        return '"' + val.replace(/"/g, '\\"') + '"';
      case "boolean":
      case "undefined":
        return String(val);
      case "number":
        // In JavaScript, -0 === 0 and String(-0) == "0", so we have to
        // special-case.
        if (val === -0 && 1 / val === -Infinity) {
          return "-0";
        }
        return String(val);
      case "object":
        if (val === null) {
          return "null";
        }

        // Special-case Node objects, since those come up a lot in my tests.  I
        // ignore namespaces.
        if (is_node(val)) {
          switch (val.nodeType) {
            case Node.ELEMENT_NODE:
              var ret = "<" + val.localName;
              for (var i = 0; i < val.attributes.length; i++) {
                ret +=
                  " " +
                  val.attributes[i].name +
                  '="' +
                  val.attributes[i].value +
                  '"';
              }
              ret += ">" + val.innerHTML + "</" + val.localName + ">";
              return "Element node " + truncate(ret, 60);
            case Node.TEXT_NODE:
              return 'Text node "' + truncate(val.data, 60) + '"';
            case Node.PROCESSING_INSTRUCTION_NODE:
              return (
                "ProcessingInstruction node with target " +
                format_value(truncate(val.target, 60)) +
                " and data " +
                format_value(truncate(val.data, 60))
              );
            case Node.COMMENT_NODE:
              return "Comment node <!--" + truncate(val.data, 60) + "-->";
            case Node.DOCUMENT_NODE:
              return (
                "Document node with " +
                val.childNodes.length +
                (val.childNodes.length == 1 ? " child" : " children")
              );
            case Node.DOCUMENT_TYPE_NODE:
              return "DocumentType node";
            case Node.DOCUMENT_FRAGMENT_NODE:
              return (
                "DocumentFragment node with " +
                val.childNodes.length +
                (val.childNodes.length == 1 ? " child" : " children")
              );
            default:
              return "Node object of unknown type";
          }
        }

      /* falls through */
      default:
        try {
          return typeof val + ' "' + truncate(String(val), 1000) + '"';
        } catch (e) {
          return (
            "[stringifying object threw " +
            String(e) +
            " with type " +
            String(typeof e) +
            "]"
          );
        }
    }
  }
  expose(format_value, "format_value");

  /*
   * Assertions
   */
  function assert_true(actual, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_true, "assert_true");

  function assert_false(actual, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_false, "assert_false");

  function assert_equals(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_equals, "assert_equals");

  function assert_not_equals(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_not_equals, "assert_not_equals");

  function assert_in_array(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }
  expose(assert_in_array, "assert_in_array");

  function assert_object_equals(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_object_equals, "assert_object_equals");

  function assert_array_equals(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_array_equals, "assert_array_equals");

  function assert_array_approx_equals(actual, expected, epsilon, description) {
    for (var i = 0; i < actual.length; i++) {
      tests.tests_actual_results.push(actual[i]);
    }
  }

  expose(assert_array_approx_equals, "assert_array_approx_equals");

  function assert_approx_equals(actual, expected, epsilon, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_approx_equals, "assert_approx_equals");

  function assert_less_than(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_less_than, "assert_less_than");

  function assert_greater_than(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_greater_than, "assert_greater_than");

  function assert_between_exclusive(actual, lower, upper, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_between_exclusive, "assert_between_exclusive");

  function assert_less_than_equal(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_less_than_equal, "assert_less_than_equal");

  function assert_greater_than_equal(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_greater_than_equal, "assert_greater_than_equal");

  function assert_between_inclusive(actual, lower, upper, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_between_inclusive, "assert_between_inclusive");

  function assert_regexp_match(actual, expected, description) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_regexp_match, "assert_regexp_match");

  function assert_class_string(object, class_string, description) {
    tests.tests_actual_results.push({}.toString.call(object));
  }

  expose(assert_class_string, "assert_class_string");

  function _assert_own_property(name) {
    return function(object, property_name, description) {
      tests.tests_actual_results.push(object[property_name]);
    };
  }

  expose(_assert_own_property("assert_exists"), "assert_exists");
  expose(_assert_own_property("assert_own_property"), "assert_own_property");

  function assert_not_exists(object, property_name, description) {}

  expose(assert_not_exists, "assert_not_exists");

  function _assert_inherits(name) {
    return function(object, property_name, description) {
      tests.tests_actual_results.push(object[property_name]);
    };
  }

  expose(_assert_inherits("assert_inherits"), "assert_inherits");
  expose(_assert_inherits("assert_idl_attribute"), "assert_idl_attribute");

  function assert_readonly(object, property_name, description) {
    tests.tests_actual_results.push(object[property_name]);
  }

  expose(assert_readonly, "assert_readonly");

  function assert_throws(code, func, description) {}

  expose(assert_throws, "assert_throws");

  function assert_unreached(description) {}

  expose(assert_unreached, "assert_unreached");

  function assert_any(assert_func, actual, expected_array) {
    tests.tests_actual_results.push(actual);
  }

  expose(assert_any, "assert_any");

  function Test(name, properties) {
    if (tests.file_is_test && tests.tests.length) {
      throw new Error("Tried to create a test with file_is_test");
    }
    this.name = name;

    this.phase =
      tests.phase === tests.phases.ABORTED
        ? this.phases.COMPLETE
        : this.phases.INITIAL;

    this.status = this.NOTRUN;
    this.timeout_id = null;
    this.index = null;

    this.properties = properties;
    var timeout = properties.timeout
      ? properties.timeout
      : settings.test_timeout;
    if (timeout !== null) {
      this.timeout_length = timeout * tests.timeout_multiplier;
    } else {
      this.timeout_length = null;
    }

    this.message = null;
    this.stack = null;

    this.steps = [];

    this.cleanup_callbacks = [];
    this._user_defined_cleanup_count = 0;

    tests.push(this);
  }

  Test.statuses = {
    PASS: 0,
    FAIL: 1,
    TIMEOUT: 2,
    NOTRUN: 3
  };

  Test.prototype = merge({}, Test.statuses);

  Test.prototype.phases = {
    INITIAL: 0,
    STARTED: 1,
    HAS_RESULT: 2,
    COMPLETE: 3
  };

  Test.prototype.structured_clone = function() {
    if (!this._structured_clone) {
      var msg = this.message;
      msg = msg ? String(msg) : msg;
      this._structured_clone = merge(
        {
          name: String(this.name),
          properties: merge({}, this.properties),
          phases: merge({}, this.phases)
        },
        Test.statuses
      );
    }
    this._structured_clone.status = this.status;
    this._structured_clone.message = this.message;
    this._structured_clone.stack = this.stack;
    this._structured_clone.index = this.index;
    this._structured_clone.phase = this.phase;
    return this._structured_clone;
  };

  Test.prototype.step = function(func, this_obj) {
    if (this.phase > this.phases.STARTED) {
      return;
    }
    this.phase = this.phases.STARTED;
    //If we don't get a result before the harness times out that will be a test timout
    this.set_status(this.TIMEOUT, "Test timed out");

    tests.started = true;
    tests.notify_test_state(this);

    if (this.timeout_id === null) {
      this.set_timeout();
    }

    this.steps.push(func);

    if (arguments.length === 1) {
      this_obj = this;
    }

    try {
      return func.apply(this_obj, Array.prototype.slice.call(arguments, 2));
    } catch (e) {
      if (this.phase >= this.phases.HAS_RESULT) {
        return;
      }
      var message = String(typeof e === "object" && e !== null ? e.message : e);
      var stack = e.stack ? e.stack : null;

      this.set_status(this.FAIL, message, stack);
      this.phase = this.phases.HAS_RESULT;
      this.done();
    }
  };

  Test.prototype.step_func = function(func, this_obj) {
    var test_this = this;

    if (arguments.length === 1) {
      this_obj = test_this;
    }

    return function() {
      return test_this.step.apply(
        test_this,
        [func, this_obj].concat(Array.prototype.slice.call(arguments))
      );
    };
  };

  Test.prototype.step_func_done = function(func, this_obj) {
    var test_this = this;

    if (arguments.length === 1) {
      this_obj = test_this;
    }

    return function() {
      if (func) {
        test_this.step.apply(
          test_this,
          [func, this_obj].concat(Array.prototype.slice.call(arguments))
        );
      }
      test_this.done();
    };
  };

  Test.prototype.unreached_func = function(description) {
    return this.step_func(function() {
      assert_unreached(description);
    });
  };

  Test.prototype.step_timeout = function(f, timeout) {
    var test_this = this;
    var args = Array.prototype.slice.call(arguments, 2);
    return setTimeout(
      this.step_func(function() {
        return f.apply(test_this, args);
      }),
      timeout * tests.timeout_multiplier
    );
  };

  /*
     * Private method for registering cleanup functions. `testharness.js`
     * internals should use this method instead of the public `add_cleanup`
     * method in order to hide implementation details from the harness status
     * message in the case errors.
     */
  Test.prototype._add_cleanup = function(callback) {
    this.cleanup_callbacks.push(callback);
  };

  /*
     * Schedule a function to be run after the test result is known, regardless
     * of passing or failing state. The behavior of this function will not
     * influence the result of the test, but if an exception is thrown, the
     * test harness will report an error.
     */
  Test.prototype.add_cleanup = function(callback) {
    this._user_defined_cleanup_count += 1;
    this._add_cleanup(callback);
  };

  Test.prototype.set_timeout = function() {
    if (this.timeout_length !== null) {
      var this_obj = this;
      this.timeout_id = setTimeout(function() {
        this_obj.timeout();
      }, this.timeout_length);
    }
  };

  Test.prototype.set_status = function(status, message, stack) {
    this.status = status;
    this.message = message;
    this.stack = stack ? stack : null;
  };

  Test.prototype.timeout = function() {
    this.timeout_id = null;
    this.set_status(this.TIMEOUT, "Test timed out");
    this.phase = this.phases.HAS_RESULT;
    this.done();
  };

  Test.prototype.force_timeout = Test.prototype.timeout;

  Test.prototype.done = function() {
    if (this.phase == this.phases.COMPLETE) {
      return;
    }

    if (this.phase <= this.phases.STARTED) {
      this.set_status(this.PASS, null);
    }

    this.phase = this.phases.COMPLETE;

    if (global_scope.clearTimeout) {
      clearTimeout(this.timeout_id);
    }
    tests.result(this);
    this.cleanup();
  };

  /*
     * Invoke all specified cleanup functions. If one or more produce an error,
     * the context is in an unpredictable state, so all further testing should
     * be cancelled.
     */
  Test.prototype.cleanup = function() {
    var error_count = 0;
    var total;

    forEach(this.cleanup_callbacks, function(cleanup_callback) {
      try {
        cleanup_callback();
      } catch (e) {
        // Set test phase immediately so that tests declared
        // within subsequent cleanup functions are not run.
        tests.phase = tests.phases.ABORTED;
        error_count += 1;
      }
    });

    if (error_count > 0) {
      total = this._user_defined_cleanup_count;
      tests.status.status = tests.status.ERROR;
      tests.status.message =
        "Test named '" +
        this.name +
        "' specified " +
        total +
        " 'cleanup' function" +
        (total > 1 ? "s" : "") +
        ", and " +
        error_count +
        " failed.";
      tests.status.stack = null;
    }
  };

  function merge(a, b) {
    var rv = {};
    var p;
    for (p in a) {
      rv[p] = a[p];
    }
    for (p in b) {
      rv[p] = b[p];
    }
    return rv;
  }

  /*
     * Utility funcions
     */
  function assert(
    expected_true,
    function_name,
    description,
    error,
    substitutions
  ) {}

  function expose(object, name) {
    var components = name.split(".");
    var target = global_scope;
    for (var i = 0; i < components.length - 1; i++) {
      if (!(components[i] in target)) {
        target[components[i]] = {};
      }
      target = target[components[i]];
    }
    target[components[components.length - 1]] = object;
  }

  function forEach(array, callback, thisObj) {
    for (var i = 0; i < array.length; i++) {
      if (array.hasOwnProperty(i)) {
        callback.call(thisObj, array[i], i, array);
      }
    }
  }

  function Tests() {
    this.tests = [];
    this.num_pending = 0;

    this.phases = {
      INITIAL: 0,
      SETUP: 1,
      HAVE_TESTS: 2,
      HAVE_RESULTS: 3,
      COMPLETE: 4,
      ABORTED: 5
    };
    this.phase = this.phases.INITIAL;

    this.properties = {};

    this.wait_for_finish = false;
    this.processing_callbacks = false;

    this.allow_uncaught_exception = false;

    this.file_is_test = false;

    this.timeout_multiplier = 1;
    this.timeout_length = test_environment.test_timeout();
    this.timeout_id = null;

    this.start_callbacks = [];
    this.test_state_callbacks = [];
    this.test_done_callbacks = [];
    this.all_done_callbacks = [];
    this.tests_actual_results = [];

    this.pending_remotes = [];

    this.status = {};

    var this_obj = this;

    test_environment.add_on_loaded_callback(function() {
      if (this_obj.all_done()) {
        this_obj.complete();
      }
    });

    this.set_timeout();
  }

  Tests.prototype.setup = function(func, properties) {
    if (this.phase >= this.phases.HAVE_RESULTS) {
      return;
    }

    if (this.phase < this.phases.SETUP) {
      this.phase = this.phases.SETUP;
    }

    this.properties = properties;

    for (var p in properties) {
      if (properties.hasOwnProperty(p)) {
        var value = properties[p];
        if (p == "allow_uncaught_exception") {
          this.allow_uncaught_exception = value;
        } else if (p == "explicit_done" && value) {
          this.wait_for_finish = true;
        } else if (p == "explicit_timeout" && value) {
          this.timeout_length = null;
          if (this.timeout_id) {
            clearTimeout(this.timeout_id);
          }
        } else if (p == "timeout_multiplier") {
          this.timeout_multiplier = value;
        }
      }
    }

    if (func) {
      try {
        func();
      } catch (e) {
        this.status.status = this.status.ERROR;
        this.status.message = String(e);
        this.status.stack = e.stack ? e.stack : null;
      }
    }
    this.set_timeout();
  };

  Tests.prototype.set_file_is_test = function() {
    if (this.tests.length > 0) {
      throw new Error("Tried to set file as test after creating a test");
    }
    this.wait_for_finish = true;
    this.file_is_test = true;
    // Create the test, which will add it to the list of tests
    async_test();
  };

  Tests.prototype.set_timeout = function() {
    if (global_scope.clearTimeout) {
      var this_obj = this;
      clearTimeout(this.timeout_id);
      if (this.timeout_length !== null) {
        this.timeout_id = setTimeout(function() {
          this_obj.timeout();
        }, this.timeout_length);
      }
    }
  };

  Tests.prototype.timeout = function() {
    if (this.status.status === null) {
      this.status.status = this.status.TIMEOUT;
    }
    this.complete();
  };

  Tests.prototype.end_wait = function() {
    this.wait_for_finish = false;
    if (this.all_done()) {
      this.complete();
    }
  };

  Tests.prototype.push = function(test) {
    if (this.phase < this.phases.HAVE_TESTS) {
      this.start();
    }
    this.num_pending++;
    test.index = this.tests.push(test);
    this.notify_test_state(test);
  };

  Tests.prototype.notify_test_state = function(test) {
    var this_obj = this;
    forEach(this.test_state_callbacks, function(callback) {
      callback(test, this_obj);
    });
  };

  Tests.prototype.all_done = function() {
    return (
      this.phase === this.phases.ABORTED ||
      (this.tests.length > 0 &&
        test_environment.all_loaded &&
        this.num_pending === 0 &&
        !this.wait_for_finish &&
        !this.processing_callbacks &&
        !this.pending_remotes.some(function(w) {
          return w.running;
        }))
    );
  };

  Tests.prototype.start = function() {
    this.phase = this.phases.HAVE_TESTS;
    this.notify_start();
  };

  Tests.prototype.notify_start = function() {
    var this_obj = this;
    forEach(this.start_callbacks, function(callback) {
      callback(this_obj.properties);
    });
  };

  Tests.prototype.result = function(test) {
    if (this.phase > this.phases.HAVE_RESULTS) {
      return;
    }
    this.phase = this.phases.HAVE_RESULTS;
    this.num_pending--;
    this.notify_result(test);
  };

  Tests.prototype.notify_result = function(test) {
    var this_obj = this;
    this.processing_callbacks = true;
    forEach(this.test_done_callbacks, function(callback) {
      callback(test, this_obj);
    });
    this.processing_callbacks = false;
    if (this_obj.all_done()) {
      this_obj.complete();
    }
  };

  Tests.prototype.complete = function() {
    if (this.phase === this.phases.COMPLETE) {
      return;
    }
    this.phase = this.phases.COMPLETE;
    var this_obj = this;
    this.tests.forEach(function(x) {
      if (x.phase < x.phases.COMPLETE) {
        this_obj.notify_result(x);
        x.cleanup();
        x.phase = x.phases.COMPLETE;
      }
    });
    this.notify_complete();
  };

  /*
     * Determine if any tests share the same `name` property. Return an array
     * containing the names of any such duplicates.
     */
  Tests.prototype.find_duplicates = function() {
    var names = Object.create(null);
    var duplicates = [];

    forEach(this.tests, function(test) {
      if (test.name in names && duplicates.indexOf(test.name) === -1) {
        duplicates.push(test.name);
      }
      names[test.name] = true;
    });

    return duplicates;
  };

  Tests.prototype.notify_complete = function() {
    var this_obj = this;
    var duplicates;

    if (this.status.status === null) {
      duplicates = this.find_duplicates();

      // Test names are presumed to be unique within test files--this
      // allows consumers to use them for identification purposes.
      // Duplicated names violate this expectation and should therefore
      // be reported as an error.
      if (duplicates.length) {
        this.status.status = this.status.ERROR;
        this.status.message =
          duplicates.length +
          " duplicate test name" +
          (duplicates.length > 1 ? "s" : "") +
          ': "' +
          duplicates.join('", "') +
          '"';
      } else {
        this.status.status = this.status.OK;
      }
    }

    forEach(this.all_done_callbacks, function(callback) {
      callback(this_obj.tests, this_obj.status);
    });
  };

  /*
     * Constructs a RemoteContext that tracks tests from a specific worker.
     */
  Tests.prototype.create_remote_worker = function(worker) {
    var message_port;

    if (is_service_worker(worker)) {
      if (window.MessageChannel) {
        // The ServiceWorker's implicit MessagePort is currently not
        // reliably accessible from the ServiceWorkerGlobalScope due to
        // Blink setting MessageEvent.source to null for messages sent
        // via ServiceWorker.postMessage(). Until that's resolved,
        // create an explicit MessageChannel and pass one end to the
        // worker.
        var message_channel = new MessageChannel();
        message_port = message_channel.port1;
        message_port.start();
        worker.postMessage({ type: "connect" }, [message_channel.port2]);
      } else {
        // If MessageChannel is not available, then try the
        // ServiceWorker.postMessage() approach using MessageEvent.source
        // on the other end.
        message_port = navigator.serviceWorker;
        worker.postMessage({ type: "connect" });
      }
    } else if (is_shared_worker(worker)) {
      message_port = worker.port;
      message_port.start();
    } else {
      message_port = worker;
    }

    return new RemoteContext(worker, message_port);
  };

  /*
     * Constructs a RemoteContext that tracks tests from a specific window.
     */
  Tests.prototype.create_remote_window = function(remote) {
    remote.postMessage({ type: "getmessages" }, "*");
    return new RemoteContext(remote, window, function(msg) {
      return msg.source === remote;
    });
  };

  Tests.prototype.fetch_tests_from_worker = function(worker) {
    if (this.phase >= this.phases.COMPLETE) {
      return;
    }

    var remoteContext = this.create_remote_worker(worker);
    this.pending_remotes.push(remoteContext);
    return remoteContext.done;
  };

  function fetch_tests_from_worker(port) {
    return tests.fetch_tests_from_worker(port);
  }
  expose(fetch_tests_from_worker, "fetch_tests_from_worker");

  Tests.prototype.fetch_tests_from_window = function(remote) {
    if (this.phase >= this.phases.COMPLETE) {
      return;
    }

    this.pending_remotes.push(this.create_remote_window(remote));
  };

  function fetch_tests_from_window(window) {
    tests.fetch_tests_from_window(window);
  }
  expose(fetch_tests_from_window, "fetch_tests_from_window");

  function timeout() {
    if (tests.timeout_length === null) {
      tests.timeout();
    }
  }
  expose(timeout, "timeout");

  function add_start_callback(callback) {
    tests.start_callbacks.push(callback);
  }

  function add_test_state_callback(callback) {
    tests.test_state_callbacks.push(callback);
  }

  function add_result_callback(callback) {
    tests.test_done_callbacks.push(callback);
  }

  function add_completion_callback(callback) {
    tests.all_done_callbacks.push(callback);
  }

  expose(add_start_callback, "add_start_callback");
  expose(add_test_state_callback, "add_test_state_callback");
  expose(add_result_callback, "add_result_callback");
  expose(add_completion_callback, "add_completion_callback");

  function remove(array, item) {
    var index = array.indexOf(item);
    if (index > -1) {
      array.splice(index, 1);
    }
  }

  function remove_start_callback(callback) {
    remove(tests.start_callbacks, callback);
  }

  function remove_test_state_callback(callback) {
    remove(tests.test_state_callbacks, callback);
  }

  function remove_result_callback(callback) {
    remove(tests.test_done_callbacks, callback);
  }

  function remove_completion_callback(callback) {
    remove(tests.all_done_callbacks, callback);
  }

  function supports_post_message(w) {
    var supports;
    var type;
    // Given IE implements postMessage across nested iframes but not across
    // windows or tabs, you can't infer cross-origin communication from the presence
    // of postMessage on the current window object only.
    //
    // Touching the postMessage prop on a window can throw if the window is
    // not from the same origin AND post message is not supported in that
    // browser. So just doing an existence test here won't do, you also need
    // to wrap it in a try..cacth block.
    try {
      type = typeof w.postMessage;
      if (type === "function") {
        supports = true;
      } else if (type === "object") {
        // IE8 supports postMessage, but implements it as a host object which
        // returns "object" as its `typeof`.
        supports = true;
      } else {
        // This is the case where postMessage isn't supported AND accessing a
        // window property across origins does NOT throw (e.g. old Safari browser).
        supports = false;
      }
    } catch (e) {
      // This is the case where postMessage isn't supported AND accessing a
      // window property across origins throws (e.g. old Firefox browser).
      supports = false;
    }
    return supports;
  }

  /**
   * Setup globals
   */
  var tests = new Tests();

  test_environment.on_tests_ready();
})(this);
