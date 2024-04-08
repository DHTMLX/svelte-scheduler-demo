var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    function dhtmlxHook() {
      typeof dhtmlx < "u" && dhtmlx.attaches && (dhtmlx.attaches.attachScheduler = function(e, a, t, n) {
        t = t || '<div class="dhx_cal_tab" name="day_tab" data-tab="day" style="right:204px;"></div><div class="dhx_cal_tab" name="week_tab" data-tab="week" style="right:140px;"></div><div class="dhx_cal_tab" name="month_tab" data-tab="month" style="right:76px;"></div>';
        var o = document.createElement("DIV");
        return o.id = "dhxSchedObj_" + this._genStr(12), o.innerHTML = '<div id="' + o.id + '" class="dhx_cal_container" style="width:100%; height:100%;"><div class="dhx_cal_navline"><div class="dhx_cal_prev_button"></div><div class="dhx_cal_next_button"></div><div class="dhx_cal_today_button"></div><div class="dhx_cal_date"></div>' + t + '</div><div class="dhx_cal_header"></div><div class="dhx_cal_data"></div></div>', document.body.appendChild(o.firstChild), this.attachObject(o.id, !1, !0), this.vs[this.av].sched = n, this.vs[this.av].schedId = o.id, n.setSizes = n.updateView, n.destructor = function() {
        }, n.init(o.id, e, a), this.vs[this._viewRestore()].sched;
      });
    }
    var globalScope;
    globalScope = typeof window < "u" ? window : global;
    const global$1 = globalScope;
    function assert(e) {
      return function(a, t) {
        a || e.config.show_errors && e.callEvent("onError", [t]) !== !1 && (e.message ? e.message({ type: "error", text: t, expire: -1 }) : console.log(t));
      };
    }
    function extend$p(e) {
      var a = { agenda: "https://docs.dhtmlx.com/scheduler/agenda_view.html", grid: "https://docs.dhtmlx.com/scheduler/grid_view.html", map: "https://docs.dhtmlx.com/scheduler/map_view.html", unit: "https://docs.dhtmlx.com/scheduler/units_view.html", timeline: "https://docs.dhtmlx.com/scheduler/timeline_view.html", week_agenda: "https://docs.dhtmlx.com/scheduler/weekagenda_view.html", year: "https://docs.dhtmlx.com/scheduler/year_view.html", anythingElse: "https://docs.dhtmlx.com/scheduler/views.html" }, t = { agenda: "ext/dhtmlxscheduler_agenda_view.js", grid: "ext/dhtmlxscheduler_grid_view.js", map: "ext/dhtmlxscheduler_map_view.js", unit: "ext/dhtmlxscheduler_units.js", timeline: "ext/dhtmlxscheduler_timeline.js, ext/dhtmlxscheduler_treetimeline.js, ext/dhtmlxscheduler_daytimeline.js", week_agenda: "ext/dhtmlxscheduler_week_agenda.js", year: "ext/dhtmlxscheduler_year_view.js", limit: "ext/dhtmlxscheduler_limit.js" };
      e._commonErrorMessages = { unknownView: function(n) {
        var o = t[n] ? "You're probably missing " + t[n] + "." : "";
        return "`" + n + "` view is not defined. \nPlease check parameters you pass to `scheduler.init` or `scheduler.setCurrentView` in your code and ensure you've imported appropriate extensions. \n" + ("Related docs: " + (a[n] || a.anythingElse)) + `
` + (o ? o + `
` : "");
      }, collapsedContainer: function(n) {
        return `Scheduler container height is set to *100%* but the rendered height is zero and the scheduler is not visible. 
Make sure that the container has some initial height or use different units. For example:
<div id='scheduler_here' class='dhx_cal_container' style='width:100%; height:600px;'> 
`;
      } }, e.createTimelineView = function() {
        throw new Error("scheduler.createTimelineView is not implemented. Be sure to add the required extension: " + t.timeline + `
Related docs: ` + a.timeline);
      }, e.createUnitsView = function() {
        throw new Error("scheduler.createUnitsView is not implemented. Be sure to add the required extension: " + t.unit + `
Related docs: ` + a.unit);
      }, e.createGridView = function() {
        throw new Error("scheduler.createGridView is not implemented. Be sure to add the required extension: " + t.grid + `
Related docs: ` + a.grid);
      }, e.addMarkedTimespan = function() {
        throw new Error(`scheduler.addMarkedTimespan is not implemented. Be sure to add the required extension: ext/dhtmlxscheduler_limit.js
Related docs: https://docs.dhtmlx.com/scheduler/limits.html`);
      }, e.renderCalendar = function() {
        throw new Error(`scheduler.renderCalendar is not implemented. Be sure to add the required extension: ext/dhtmlxscheduler_minical.js
https://docs.dhtmlx.com/scheduler/minicalendar.html`);
      }, e.exportToPNG = function() {
        throw new Error(["scheduler.exportToPNG is not implemented.", "This feature requires an additional module, be sure to check the related doc here https://docs.dhtmlx.com/scheduler/png.html", "Licensing info: https://dhtmlx.com/docs/products/dhtmlxScheduler/export.shtml"].join(`
`));
      }, e.exportToPDF = function() {
        throw new Error(["scheduler.exportToPDF is not implemented.", "This feature requires an additional module, be sure to check the related doc here https://docs.dhtmlx.com/scheduler/pdf.html", "Licensing info: https://dhtmlx.com/docs/products/dhtmlxScheduler/export.shtml"].join(`
`));
      };
    }
    function extend$o(e) {
      e.attachEvent("onSchedulerReady", function() {
        typeof dhtmlxError < "u" && window.dhtmlxError.catchError("LoadXML", function(a, t, n) {
          var o = n[0].responseText;
          switch (e.config.ajax_error) {
            case "alert":
              global$1.alert(o);
              break;
            case "console":
              global$1.console.log(o);
          }
        });
      });
    }
    function extend$n(e) {
      function a(i) {
        var s = document.createElement("div");
        return (i || "").split(" ").forEach(function(_) {
          s.classList.add(_);
        }), s;
      }
      var t = { rows_container: function() {
        return a("dhx_cal_navbar_rows_container");
      }, row: function() {
        return a("dhx_cal_navbar_row");
      }, view: function(i) {
        var s = a("dhx_cal_tab");
        return s.setAttribute("name", i.view + "_tab"), s.setAttribute("data-tab", i.view), e.config.fix_tab_position && (i.$firstTab ? s.classList.add("dhx_cal_tab_first") : i.$lastTab ? s.classList.add("dhx_cal_tab_last") : i.view !== "week" && s.classList.add("dhx_cal_tab_standalone"), i.$segmentedTab && s.classList.add("dhx_cal_tab_segmented")), s;
      }, date: function() {
        return a("dhx_cal_date");
      }, button: function(i) {
        return a("dhx_cal_nav_button dhx_cal_nav_button_custom dhx_cal_tab");
      }, builtInButton: function(i) {
        return a("dhx_cal_" + i.view + "_button dhx_cal_nav_button");
      }, spacer: function() {
        return a("dhx_cal_line_spacer");
      }, minicalendarButton: function(i) {
        var s = a("dhx_minical_icon");
        return i.click || s.$_eventAttached || e.event(s, "click", function() {
          e.isCalendarVisible() ? e.destroyCalendar() : e.renderCalendar({ position: this, date: e.getState().date, navigation: !0, handler: function(_, l) {
            e.setCurrentView(_), e.destroyCalendar();
          } });
        }), s;
      }, html_element: function(i) {
        return a("dhx_cal_nav_content");
      } };
      function n(i) {
        var s = function(h) {
          var u;
          if (h.view)
            switch (h.view) {
              case "today":
              case "next":
              case "prev":
                u = t.builtInButton;
                break;
              case "date":
                u = t.date;
                break;
              case "spacer":
                u = t.spacer;
                break;
              case "button":
                u = t.button;
                break;
              case "minicalendar":
                u = t.minicalendarButton;
                break;
              default:
                u = t.view;
            }
          else
            h.rows ? u = t.rows_container : h.cols && (u = t.row);
          return u;
        }(i);
        if (s) {
          var _ = s(i);
          if (i.css && _.classList.add(i.css), i.width && ((l = i.width) === 1 * l && (l += "px"), _.style.width = l), i.height && ((l = i.height) === 1 * l && (l += "px"), _.style.height = l), i.click && e.event(_, "click", i.click), i.html && (_.innerHTML = i.html), i.align) {
            var l = "";
            i.align == "right" ? l = "flex-end" : i.align == "left" && (l = "flex-start"), _.style.justifyContent = l;
          }
          return _;
        }
      }
      function o(i) {
        return typeof i == "string" && (i = { view: i }), i.view || i.rows || i.cols || (i.view = "button"), i;
      }
      function r(i) {
        var s, _ = document.createDocumentFragment();
        s = Array.isArray(i) ? i : [i];
        for (var l = 0; l < s.length; l++) {
          var h, u = o(s[l]);
          u.view === "day" && s[l + 1] && ((h = o(s[l + 1])).view !== "week" && h.view !== "month" || (u.$firstTab = !0, u.$segmentedTab = !0)), u.view === "week" && s[l - 1] && ((h = o(s[l + 1])).view !== "week" && h.view !== "month" || (u.$segmentedTab = !0)), u.view === "month" && s[l - 1] && ((h = o(s[l - 1])).view !== "week" && h.view !== "day" || (u.$lastTab = !0, u.$segmentedTab = !0));
          var m = n(u);
          _.appendChild(m), (u.cols || u.rows) && m.appendChild(r(u.cols || u.rows));
        }
        return _;
      }
      e._init_nav_bar = function(i) {
        var s = this.$container.querySelector(".dhx_cal_navline");
        return s || ((s = document.createElement("div")).className = "dhx_cal_navline dhx_cal_navline_flex", e._update_nav_bar(i, s), s);
      };
      var d = null;
      e._update_nav_bar = function(i, s) {
        if (i) {
          var _ = !1, l = i.height || e.xy.nav_height;
          d !== null && d === l || (_ = !0), _ && (e.xy.nav_height = l), s.innerHTML = "", s.appendChild(r(i)), e.unset_actions(), e._els = [], e.get_elements(), e.set_actions(), s.style.display = l === 0 ? "none" : "", d = l;
        }
      };
    }
    function extend$m(e) {
      function a(r) {
        for (var d = document.body; r && r != d; )
          r = r.parentNode;
        return d == r;
      }
      function t(r) {
        return { w: r.innerWidth || document.documentElement.clientWidth, h: r.innerHeight || document.documentElement.clientHeight };
      }
      function n(r, d) {
        var i, s = t(d);
        r.event(d, "resize", function() {
          clearTimeout(i), i = setTimeout(function() {
            if (a(r.$container) && !r.$destroyed) {
              var _, l, h = t(d);
              l = h, ((_ = s).w != l.w || _.h != l.h) && (s = h, o(r));
            }
          }, 150);
        });
      }
      function o(r) {
        !r.$destroyed && r.$root && a(r.$root) && r.callEvent("onSchedulerResize", []) && (r.updateView(), r.callEvent("onAfterSchedulerResize", []));
      }
      (function(r) {
        var d = r.$container;
        window.getComputedStyle(d).getPropertyValue("position") == "static" && (d.style.position = "relative");
        var i = document.createElement("iframe");
        i.className = "scheduler_container_resize_watcher", i.tabIndex = -1, r.config.wai_aria_attributes && (i.setAttribute("role", "none"), i.setAttribute("aria-hidden", !0)), window.Sfdc || window.$A || window.Aura ? function(s) {
          var _ = s.$root.offsetHeight, l = s.$root.offsetWidth;
          (function h() {
            s.$destroyed || (s.$root && (s.$root.offsetHeight == _ && s.$root.offsetWidth == l || o(s), _ = s.$root.offsetHeight, l = s.$root.offsetWidth), setTimeout(h, 200));
          })();
        }(r) : (d.appendChild(i), i.contentWindow ? n(r, i.contentWindow) : (d.removeChild(i), n(r, window)));
      })(e);
    }
    class EventHost {
      constructor() {
        this._silent_mode = !1, this.listeners = {};
      }
      _silentStart() {
        this._silent_mode = !0;
      }
      _silentEnd() {
        this._silent_mode = !1;
      }
    }
    const createEventStorage = function(e) {
      let a = {}, t = 0;
      const n = function() {
        let o = !0;
        for (const r in a) {
          const d = a[r].apply(e, arguments);
          o = o && d;
        }
        return o;
      };
      return n.addEvent = function(o, r) {
        if (typeof o == "function") {
          let d;
          if (r && r.id ? d = r.id : (d = t, t++), r && r.once) {
            const i = o;
            o = function() {
              i(), n.removeEvent(d);
            };
          }
          return a[d] = o, d;
        }
        return !1;
      }, n.removeEvent = function(o) {
        delete a[o];
      }, n.clear = function() {
        a = {};
      }, n;
    };
    function makeEventable(e) {
      const a = new EventHost();
      e.attachEvent = function(t, n, o) {
        t = "ev_" + t.toLowerCase(), a.listeners[t] || (a.listeners[t] = createEventStorage(this)), o && o.thisObject && (n = n.bind(o.thisObject));
        let r = t + ":" + a.listeners[t].addEvent(n, o);
        return o && o.id && (r = o.id), r;
      }, e.attachAll = function(t) {
        this.attachEvent("listen_all", t);
      }, e.callEvent = function(t, n) {
        if (a._silent_mode)
          return !0;
        const o = "ev_" + t.toLowerCase(), r = a.listeners;
        return r.ev_listen_all && r.ev_listen_all.apply(this, [t].concat(n)), !r[o] || r[o].apply(this, n);
      }, e.checkEvent = function(t) {
        return !!a.listeners["ev_" + t.toLowerCase()];
      }, e.detachEvent = function(t) {
        if (t) {
          let n = a.listeners;
          for (const r in n)
            n[r].removeEvent(t);
          const o = t.split(":");
          if (n = a.listeners, o.length === 2) {
            const r = o[0], d = o[1];
            n[r] && n[r].removeEvent(d);
          }
        }
      }, e.detachAllEvents = function() {
        for (const t in a.listeners)
          a.listeners[t].clear();
      };
    }
    function extend$l(e) {
      makeEventable(e), extend$n(e), e._detachDomEvent = function(i, s, _) {
        i.removeEventListener ? i.removeEventListener(s, _, !1) : i.detachEvent && i.detachEvent("on" + s, _);
      }, e._init_once = function() {
        extend$m(e), e._init_once = function() {
        };
      };
      var a = { render: function(i) {
        return e._init_nav_bar(i);
      } }, t = { render: function(i) {
        var s = document.createElement("div");
        return s.className = "dhx_cal_header", s;
      } }, n = { render: function(i) {
        var s = document.createElement("div");
        return s.className = "dhx_cal_data", s;
      } };
      function o(i) {
        return !!(i.querySelector(".dhx_cal_header") && i.querySelector(".dhx_cal_data") && i.querySelector(".dhx_cal_navline"));
      }
      e.init = function(i, s, _) {
        if (!this.$destroyed) {
          if (s = s || e._currentDate(), _ = _ || "week", this._obj && this.unset_actions(), this._obj = typeof i == "string" ? document.getElementById(i) : i, this.$container = this._obj, this.$root = this._obj, !this.$container.offsetHeight && this.$container.offsetWidth && this.$container.style.height === "100%" && window.console.error(e._commonErrorMessages.collapsedContainer(), this.$container), this.config.wai_aria_attributes && this.config.wai_aria_application_role && this.$container.setAttribute("role", "application"), this.config.header || o(this.$container) || (this.config.header = function(l) {
            var h = ["day", "week", "month"];
            if (l.matrix)
              for (var u in l.matrix)
                h.push(u);
            if (l._props)
              for (var u in l._props)
                h.push(u);
            if (l._grid && l._grid.names)
              for (var u in l._grid.names)
                h.push(u);
            return ["map", "agenda", "week_agenda", "year"].forEach(function(m) {
              l[m + "_view"] && h.push(m);
            }), h.concat(["date"]).concat(["prev", "today", "next"]);
          }(this), window.console.log(["Required DOM elements are missing from the scheduler container and **scheduler.config.header** is not specified.", "Using a default header configuration: ", "scheduler.config.header = " + JSON.stringify(this.config.header, null, 2), "Check this article for the details: https://docs.dhtmlx.com/scheduler/initialization.html"].join(`
`))), this.config.header)
            this.$container.innerHTML = "", this.$container.classList.add("dhx_cal_container"), this.config.header.height && (this.xy.nav_height = this.config.header.height), this.$container.appendChild(a.render(this.config.header)), this.$container.appendChild(t.render()), this.$container.appendChild(n.render());
          else if (!o(this.$container))
            throw new Error(["Required DOM elements are missing from the scheduler container.", "Be sure to either specify them manually in the markup: https://docs.dhtmlx.com/scheduler/initialization.html#initializingschedulerviamarkup", "Or to use **scheduler.config.header** setting so they could be created automatically: https://docs.dhtmlx.com/scheduler/initialization.html#initializingschedulerviaheaderconfig"].join(`
`));
          this.config.rtl && (this.$container.className += " dhx_cal_container_rtl"), this._skin_init && e._skin_init(), e.date.init(), this._scroll = !0, this._els = [], this.get_elements(), this.init_templates(), this.set_actions(), this._init_once(), this._init_touch_events(), this.set_sizes(), e.callEvent("onSchedulerReady", []), e.$initialized = !0, this.setCurrentView(s, _);
        }
      }, e.xy = { min_event_height: 20, bar_height: 24, scale_width: 50, scroll_width: 18, scale_height: 20, month_scale_height: 20, menu_width: 25, margin_top: 0, margin_left: 0, editor_width: 140, month_head_height: 22, event_header_height: 14 }, e.keys = { edit_save: 13, edit_cancel: 27 }, e.bind = function(i, s) {
        return i.bind ? i.bind(s) : function() {
          return i.apply(s, arguments);
        };
      }, e.set_sizes = function() {
        var i = this._x = this._obj.clientWidth - this.xy.margin_left, s = this._table_view ? 0 : this.xy.scale_width + this.xy.scroll_width, _ = this.$container.querySelector(".dhx_cal_scale_placeholder");
        e._is_material_skin() ? (_ || ((_ = document.createElement("div")).className = "dhx_cal_scale_placeholder", this.$container.insertBefore(_, this._els.dhx_cal_header[0])), _.style.display = "block", this.set_xy(_, i, this.xy.scale_height + 1, 0, this._els.dhx_cal_header[0].offsetTop)) : _ && _.parentNode.removeChild(_), this._lightbox && (e.$container.offsetWidth < 1200 || this._setLbPosition(document.querySelector(".dhx_cal_light"))), this._data_width = i - s, this._els.dhx_cal_navline[0].style.width = i + "px";
        const l = this._els.dhx_cal_header[0];
        this.set_xy(l, this._data_width, this.xy.scale_height), l.style.left = "", l.style.right = "", this._table_view ? this.config.rtl ? l.style.right = "-1px" : l.style.left = "-1px" : this.config.rtl ? l.style.right = `${this.xy.scale_width}px` : l.style.left = `${this.xy.scale_width}px`;
      }, e.set_xy = function(i, s, _, l, h) {
        function u(f) {
          let y = f;
          return isNaN(Number(y)) || (y = Math.max(0, y) + "px"), y;
        }
        var m = "left";
        s !== void 0 && (i.style.width = u(s)), _ !== void 0 && (i.style.height = u(_)), arguments.length > 3 && (l !== void 0 && (this.config.rtl && (m = "right"), i.style[m] = l + "px"), h !== void 0 && (i.style.top = h + "px"));
      }, e.get_elements = function() {
        for (var i = this._obj.getElementsByTagName("DIV"), s = 0; s < i.length; s++) {
          var _ = e._getClassName(i[s]), l = i[s].getAttribute("data-tab") || i[s].getAttribute("name") || "";
          _ && (_ = _.split(" ")[0]), this._els[_] || (this._els[_] = []), this._els[_].push(i[s]);
          var h = e.locale.labels[l + "_tab"] || e.locale.labels[l || _];
          typeof h != "string" && l && !i[s].innerHTML && (h = l.split("_")[0]), h && (this._waiAria.labelAttr(i[s], h), i[s].innerHTML = h);
        }
      };
      var r = e._createDomEventScope();
      function d(i, s) {
        const _ = new Date(i), l = (new Date(s).getTime() - _.getTime()) / 864e5;
        return Math.abs(l);
      }
      e.unset_actions = function() {
        r.detachAll();
      }, e.set_actions = function() {
        for (var i in this._els)
          if (this._click[i])
            for (var s = 0; s < this._els[i].length; s++) {
              const _ = this._els[i][s], l = this._click[i].bind(_);
              r.attach(_, "click", l);
            }
        r.attach(this._obj, "selectstart", function(_) {
          return _.preventDefault(), !1;
        }), r.attach(this._obj, "mousemove", function(_) {
          e._temp_touch_block || e._on_mouse_move(_);
        }), r.attach(this._obj, "mousedown", function(_) {
          e._ignore_next_click || e._on_mouse_down(_);
        }), r.attach(this._obj, "mouseup", function(_) {
          e._ignore_next_click || e._on_mouse_up(_);
        }), r.attach(this._obj, "dblclick", function(_) {
          e._on_dbl_click(_);
        }), r.attach(this._obj, "contextmenu", function(_) {
          e.checkEvent("onContextMenu") && _.preventDefault();
          var l = _, h = l.target || l.srcElement;
          return e.callEvent("onContextMenu", [e._locate_event(h), l]);
        });
      }, e.select = function(i) {
        this._select_id != i && (e._close_not_saved(), this.editStop(!1), this._select_id && this.unselect(), this._select_id = i, this.updateEvent(i), this.callEvent("onEventSelected", [i]));
      }, e.unselect = function(i) {
        if (!i || i == this._select_id) {
          var s = this._select_id;
          this._select_id = null, s && this.getEvent(s) && this.updateEvent(s), this.callEvent("onEventUnselected", [s]);
        }
      }, e.getState = function() {
        return { mode: this._mode, date: new Date(this._date), min_date: new Date(this._min_date), max_date: new Date(this._max_date), editor_id: this._edit_id, lightbox_id: this._lightbox_id, new_event: this._new_event, select_id: this._select_id, expanded: this.expanded, drag_id: this._drag_id, drag_mode: this._drag_mode };
      }, e._click = { dhx_cal_data: function(i) {
        if (e._ignore_next_click)
          return i.preventDefault && i.preventDefault(), i.cancelBubble = !0, e._ignore_next_click = !1, !1;
        var s = i.target, _ = e._locate_event(s);
        if (_) {
          if (!e.callEvent("onClick", [_, i]) || e.config.readonly)
            return;
        } else
          e.callEvent("onEmptyClick", [e.getActionData(i).date, i]);
        if (_ && e.config.select) {
          e.select(_);
          const h = s.closest(".dhx_menu_icon");
          var l = e._getClassName(h);
          l.indexOf("_icon") != -1 && e._click.buttons[l.split(" ")[1].replace("icon_", "")](_);
        } else
          e._close_not_saved(), e.getState().select_id && (/* @__PURE__ */ new Date()).valueOf() - (e._new_event || 0) > 500 && e.unselect();
      }, dhx_cal_prev_button: function() {
        e._click.dhx_cal_next_button(0, -1);
      }, dhx_cal_next_button: function(i, s) {
        var _ = 1;
        e.config.rtl && (s = -s, _ = -_), e.setCurrentView(e.date.add(e.date[e._mode + "_start"](new Date(e._date)), s || _, e._mode));
      }, dhx_cal_today_button: function() {
        e.callEvent("onBeforeTodayDisplayed", []) && e.setCurrentView(e._currentDate());
      }, dhx_cal_tab: function() {
        var i = this.getAttribute("data-tab"), s = this.getAttribute("name"), _ = i || s.substring(0, s.search("_tab"));
        e.setCurrentView(e._date, _);
      }, buttons: { delete: function(i) {
        var s = e.locale.labels.confirm_deleting;
        e._dhtmlx_confirm({ message: s, title: e.locale.labels.title_confirm_deleting, callback: function() {
          e.deleteEvent(i);
        }, config: { ok: e.locale.labels.icon_delete } });
      }, edit: function(i) {
        e.edit(i);
      }, save: function(i) {
        e.editStop(!0);
      }, details: function(i) {
        e.showLightbox(i);
      }, form: function(i) {
        e.showLightbox(i);
      }, cancel: function(i) {
        e.editStop(!1);
      } } }, e._dhtmlx_confirm = function({ message: i, title: s, callback: _, config: l }) {
        if (!i)
          return _();
        l = l || {};
        var h = { ...l, text: i };
        s && (h.title = s), _ && (h.callback = function(u) {
          u && _();
        }), e.confirm(h);
      }, e.addEventNow = function(i, s, _) {
        var l = {};
        e._isObject(i) && !e._isDate(i) && (l = i, i = null);
        var h = 6e4 * (this.config.event_duration || this.config.time_step);
        i || (i = l.start_date || Math.round(e._currentDate().valueOf() / h) * h);
        var u = new Date(i);
        if (!s) {
          var m = this.config.first_hour;
          m > u.getHours() && (u.setHours(m), i = u.valueOf()), s = i.valueOf() + h;
        }
        var f = new Date(s);
        u.valueOf() == f.valueOf() && f.setTime(f.valueOf() + h), l.start_date = l.start_date || u, l.end_date = l.end_date || f, l.text = l.text || this.locale.labels.new_event, l.id = this._drag_id = l.id || this.uid(), this._drag_mode = "new-size", this._loading = !0;
        var y = this.addEvent(l);
        return this.callEvent("onEventCreated", [this._drag_id, _]), this._loading = !1, this._drag_event = {}, this._on_mouse_up(_), y;
      }, e._on_dbl_click = function(i, s) {
        if (s = s || i.target || i.srcElement, !this.config.readonly) {
          var _ = e._getClassName(s).split(" ")[0];
          switch (_) {
            case "dhx_scale_holder":
            case "dhx_scale_holder_now":
            case "dhx_month_body":
            case "dhx_wa_day_data":
              if (!e.config.dblclick_create)
                break;
              this.addEventNow(this.getActionData(i).date, null, i);
              break;
            case "dhx_cal_event":
            case "dhx_wa_ev_body":
            case "dhx_agenda_line":
            case "dhx_cal_agenda_event_line":
            case "dhx_grid_event":
            case "dhx_cal_event_line":
            case "dhx_cal_event_clear":
              var l = this._locate_event(s);
              if (!this.callEvent("onDblClick", [l, i]))
                return;
              this.config.details_on_dblclick || this._table_view || !this.getEvent(l)._timed || !this.config.select ? this.showLightbox(l) : this.edit(l);
              break;
            case "dhx_time_block":
            case "dhx_cal_container":
              return;
            default:
              var h = this["dblclick_" + _];
              if (h)
                h.call(this, i);
              else if (s.parentNode && s != this)
                return e._on_dbl_click(i, s.parentNode);
          }
        }
      }, e._get_column_index = function(i) {
        var s = 0;
        if (this._cols) {
          for (var _ = 0, l = 0; _ + this._cols[l] < i && l < this._cols.length; )
            _ += this._cols[l], l++;
          if (s = l + (this._cols[l] ? (i - _) / this._cols[l] : 0), this._ignores && s >= this._cols.length)
            for (; s >= 1 && this._ignores[Math.floor(s)]; )
              s--;
        }
        return s;
      }, e._week_indexes_from_pos = function(i) {
        if (this._cols) {
          var s = this._get_column_index(i.x);
          return i.x = Math.min(this._cols.length - 1, Math.max(0, Math.ceil(s) - 1)), i.y = Math.max(0, Math.ceil(60 * i.y / (this.config.time_step * this.config.hour_size_px)) - 1) + this.config.first_hour * (60 / this.config.time_step), i;
        }
        return i;
      }, e._mouse_coords = function(i) {
        var s, _ = document.body, l = document.documentElement;
        s = this.$env.isIE || !i.pageX && !i.pageY ? { x: i.clientX + (_.scrollLeft || l.scrollLeft || 0) - _.clientLeft, y: i.clientY + (_.scrollTop || l.scrollTop || 0) - _.clientTop } : { x: i.pageX, y: i.pageY }, this.config.rtl && this._colsS ? (s.x = this.$container.querySelector(".dhx_cal_data").offsetWidth - s.x, s.x += this.$domHelpers.getAbsoluteLeft(this._obj), this._mode !== "month" && (s.x -= this.xy.scale_width)) : s.x -= this.$domHelpers.getAbsoluteLeft(this._obj) + (this._table_view ? 0 : this.xy.scale_width);
        var h = this.$container.querySelector(".dhx_cal_data");
        s.y -= this.$domHelpers.getAbsoluteTop(h) - this._els.dhx_cal_data[0].scrollTop, s.ev = i;
        var u = this["mouse_" + this._mode];
        if (u)
          s = u.call(this, s);
        else if (this._table_view) {
          var m = this._get_column_index(s.x);
          if (!this._cols || !this._colsS)
            return s;
          var f = 0;
          for (f = 1; f < this._colsS.heights.length && !(this._colsS.heights[f] > s.y); f++)
            ;
          s.y = Math.ceil(24 * (Math.max(0, m) + 7 * Math.max(0, f - 1)) * 60 / this.config.time_step), (e._drag_mode || this._mode == "month") && (s.y = 24 * (Math.max(0, Math.ceil(m) - 1) + 7 * Math.max(0, f - 1)) * 60 / this.config.time_step), this._drag_mode == "move" && e._ignores_detected && e.config.preserve_length && (s._ignores = !0, this._drag_event._event_length || (this._drag_event._event_length = this._get_real_event_length(this._drag_event.start_date, this._drag_event.end_date, { x_step: 1, x_unit: "day" }))), s.x = 0;
        } else
          s = this._week_indexes_from_pos(s);
        return s.timestamp = +/* @__PURE__ */ new Date(), s;
      }, e._close_not_saved = function() {
        if ((/* @__PURE__ */ new Date()).valueOf() - (e._new_event || 0) > 500 && e._edit_id) {
          var i = e.locale.labels.confirm_closing;
          e._dhtmlx_confirm({ message: i, title: e.locale.labels.title_confirm_closing, callback: function() {
            e.editStop(e.config.positive_closing);
          } }), i && (this._drag_id = this._drag_pos = this._drag_mode = null);
        }
      }, e._correct_shift = function(i, s) {
        return i - 6e4 * (new Date(e._min_date).getTimezoneOffset() - new Date(i).getTimezoneOffset()) * (s ? -1 : 1);
      }, e._is_pos_changed = function(i, s) {
        function _(l, h, u) {
          return Math.abs(l - h) > u;
        }
        return !i || !this._drag_pos ? !0 : !!(this._drag_pos.has_moved || !this._drag_pos.timestamp || s.timestamp - this._drag_pos.timestamp > 100 || _(i.ev.clientX, s.ev.clientX, 5) || _(i.ev.clientY, s.ev.clientY, 5));
      }, e._correct_drag_start_date = function(i) {
        var s;
        e.matrix && (s = e.matrix[e._mode]), s = s || { x_step: 1, x_unit: "day" }, i = new Date(i);
        var _ = 1;
        return (s._start_correction || s._end_correction) && (_ = 60 * (s.last_hour || 0) - (60 * i.getHours() + i.getMinutes()) || 1), 1 * i + (e._get_fictional_event_length(i, _, s) - _);
      }, e._correct_drag_end_date = function(i, s) {
        var _;
        e.matrix && (_ = e.matrix[e._mode]), _ = _ || { x_step: 1, x_unit: "day" };
        var l = 1 * i + e._get_fictional_event_length(i, s, _);
        return new Date(1 * l - (e._get_fictional_event_length(l, -1, _, -1) + 1));
      }, e._on_mouse_move = function(i) {
        if (this._drag_mode) {
          var s = this._mouse_coords(i);
          if (this._is_pos_changed(this._drag_pos, s)) {
            var _, l;
            if (this._edit_id != this._drag_id && this._close_not_saved(), !this._drag_mode)
              return;
            var h = null;
            if (this._drag_pos && !this._drag_pos.has_moved && ((h = this._drag_pos).has_moved = !0), this._drag_pos = s, this._drag_pos.has_moved = !0, this._drag_mode == "create") {
              if (h && (s = h), this._close_not_saved(), this.unselect(this._select_id), this._loading = !0, _ = this._get_date_from_pos(s).valueOf(), !this._drag_start)
                return this.callEvent("onBeforeEventCreated", [i, this._drag_id]) ? (this._loading = !1, void (this._drag_start = _)) : void (this._loading = !1);
              l = _, this._drag_start;
              var u = new Date(this._drag_start), m = new Date(l);
              this._mode != "day" && this._mode != "week" || u.getHours() != m.getHours() || u.getMinutes() != m.getMinutes() || (m = new Date(this._drag_start + 1e3)), this._drag_id = this.uid(), this.addEvent(u, m, this.locale.labels.new_event, this._drag_id, s.fields), this.callEvent("onEventCreated", [this._drag_id, i]), this._loading = !1, this._drag_mode = "new-size";
            }
            var f, y = this.config.time_step, b = this.getEvent(this._drag_id);
            if (e.matrix && (f = e.matrix[e._mode]), f = f || { x_step: 1, x_unit: "day" }, this._drag_mode == "move")
              _ = this._min_date.valueOf() + 6e4 * (s.y * this.config.time_step + 24 * s.x * 60), !s.custom && this._table_view && (_ += 1e3 * this.date.time_part(b.start_date)), !this._table_view && this._dragEventBody && this._drag_event._move_event_shift === void 0 && (this._drag_event._move_event_shift = _ - b.start_date), this._drag_event._move_event_shift && (_ -= this._drag_event._move_event_shift), _ = this._correct_shift(_), s._ignores && this.config.preserve_length && this._table_view && f ? (_ = e._correct_drag_start_date(_), l = e._correct_drag_end_date(_, this._drag_event._event_length)) : l = b.end_date.valueOf() - (b.start_date.valueOf() - _);
            else {
              if (_ = b.start_date.valueOf(), l = b.end_date.valueOf(), this._table_view) {
                var c = this._min_date.valueOf() + s.y * this.config.time_step * 6e4 + (s.custom ? 0 : 864e5);
                if (this._mode == "month")
                  if (c = this._correct_shift(c, !1), this._drag_from_start) {
                    var g = 864e5;
                    c <= e.date.date_part(new Date(l + g - 1)).valueOf() && (_ = c - g);
                  } else
                    l = c;
                else
                  this.config.preserve_length ? s.resize_from_start ? _ = e._correct_drag_start_date(c) : l = e._correct_drag_end_date(c, 0) : s.resize_from_start ? _ = c : l = c;
              } else {
                var v = this.date.date_part(new Date(b.end_date.valueOf() - 1)).valueOf(), p = new Date(v), x = this.config.first_hour, w = 60 / y * (this.config.last_hour - x);
                this.config.time_step = 1;
                var k = this._mouse_coords(i);
                this.config.time_step = y;
                var E = s.y * y * 6e4, D = Math.min(s.y + 1, w) * y * 6e4, S = 6e4 * k.y;
                l = Math.abs(E - S) > Math.abs(D - S) ? v + D : v + E, l += 6e4 * (new Date(l).getTimezoneOffset() - p.getTimezoneOffset()), this._els.dhx_cal_data[0].style.cursor = "s-resize", this._mode != "week" && this._mode != "day" || (l = this._correct_shift(l));
              }
              if (this._drag_mode == "new-size")
                if (l <= this._drag_start) {
                  var N = s.shift || (this._table_view && !s.custom ? 864e5 : 0);
                  _ = l - (s.shift ? 0 : N), l = this._drag_start + (N || 6e4 * y);
                } else
                  _ = this._drag_start;
              else
                l <= _ && (l = _ + 6e4 * y);
            }
            var A = new Date(l - 1), M = new Date(_);
            if (this._drag_mode == "move" && e.config.limit_drag_out && (+M < +e._min_date || +l > +e._max_date)) {
              if (+b.start_date < +e._min_date || +b.end_date > +e._max_date)
                M = new Date(b.start_date), l = new Date(b.end_date);
              else {
                var C = l - M;
                +M < +e._min_date ? (M = new Date(e._min_date), s._ignores && this.config.preserve_length && this._table_view ? (M = new Date(e._correct_drag_start_date(M)), f._start_correction && (M = new Date(M.valueOf() + f._start_correction)), l = new Date(1 * M + this._get_fictional_event_length(M, this._drag_event._event_length, f))) : l = new Date(+M + C)) : (l = new Date(e._max_date), s._ignores && this.config.preserve_length && this._table_view ? (f._end_correction && (l = new Date(l.valueOf() - f._end_correction)), l = new Date(1 * l - this._get_fictional_event_length(l, 0, f, !0)), M = new Date(1 * l - this._get_fictional_event_length(l, this._drag_event._event_length, f, !0)), this._ignores_detected && (M = e.date.add(M, f.x_step, f.x_unit), l = new Date(1 * l - this._get_fictional_event_length(l, 0, f, !0)), l = e.date.add(l, f.x_step, f.x_unit))) : M = new Date(+l - C));
              }
              A = new Date(l - 1);
            }
            if (!this._table_view && this._dragEventBody && !e.config.all_timed && (!e._get_section_view() && s.x != this._get_event_sday({ start_date: new Date(_), end_date: new Date(_) }) || new Date(_).getHours() < this.config.first_hour) && (C = l - M, this._drag_mode == "move" && (g = this._min_date.valueOf() + 24 * s.x * 60 * 6e4, (M = new Date(g)).setHours(this.config.first_hour), l = new Date(M.valueOf() + C), A = new Date(l - 1))), !this._table_view && !e.config.all_timed && (!e.getView() && s.x != this._get_event_sday({ start_date: new Date(l), end_date: new Date(l) }) || new Date(l).getHours() >= this.config.last_hour) && (C = l - M, g = this._min_date.valueOf() + 24 * s.x * 60 * 6e4, (l = e.date.date_part(new Date(g))).setHours(this.config.last_hour), A = new Date(l - 1), this._drag_mode == "move" && (M = new Date(+l - C))), this._table_view || A.getDate() == M.getDate() && A.getHours() < this.config.last_hour || e._allow_dnd)
              if (b.start_date = M, b.end_date = new Date(l), this.config.update_render) {
                var T = e._els.dhx_cal_data[0].scrollTop;
                this.update_view(), e._els.dhx_cal_data[0].scrollTop = T;
              } else
                this.updateEvent(this._drag_id);
            this._table_view && this.for_rendered(this._drag_id, function(L) {
              L.className += " dhx_in_move dhx_cal_event_drag";
            }), this.callEvent("onEventDrag", [this._drag_id, this._drag_mode, i]);
          }
        } else if (e.checkEvent("onMouseMove")) {
          var O = this._locate_event(i.target || i.srcElement);
          this.callEvent("onMouseMove", [O, i]);
        }
      }, e._on_mouse_down = function(i, s) {
        if (i.button != 2 && !this.config.readonly && !this._drag_mode) {
          s = s || i.target || i.srcElement;
          var _ = e._getClassName(s).split(" ")[0];
          switch (this.config.drag_event_body && _ == "dhx_body" && s.parentNode && s.parentNode.className.indexOf("dhx_cal_select_menu") === -1 && (_ = "dhx_event_move", this._dragEventBody = !0), _) {
            case "dhx_cal_event_line":
            case "dhx_cal_event_clear":
              this._table_view && (this._drag_mode = "move");
              break;
            case "dhx_event_move":
            case "dhx_wa_ev_body":
              this._drag_mode = "move";
              break;
            case "dhx_event_resize":
              this._drag_mode = "resize", e._getClassName(s).indexOf("dhx_event_resize_end") < 0 ? e._drag_from_start = !0 : e._drag_from_start = !1;
              break;
            case "dhx_scale_holder":
            case "dhx_scale_holder_now":
            case "dhx_month_body":
            case "dhx_matrix_cell":
            case "dhx_marked_timespan":
              this._drag_mode = "create";
              break;
            case "":
              if (s.parentNode)
                return e._on_mouse_down(i, s.parentNode);
              break;
            default:
              if ((!e.checkEvent("onMouseDown") || e.callEvent("onMouseDown", [_, i])) && s.parentNode && s != this && _ != "dhx_body")
                return e._on_mouse_down(i, s.parentNode);
              this._drag_mode = null, this._drag_id = null;
          }
          if (this._drag_mode) {
            var l = this._locate_event(s);
            if (this.config["drag_" + this._drag_mode] && this.callEvent("onBeforeDrag", [l, this._drag_mode, i])) {
              if (this._drag_id = l, (this._edit_id != this._drag_id || this._edit_id && this._drag_mode == "create") && this._close_not_saved(), !this._drag_mode)
                return;
              this._drag_event = e._lame_clone(this.getEvent(this._drag_id) || {}), this._drag_pos = this._mouse_coords(i);
            } else
              this._drag_mode = this._drag_id = 0;
          }
          this._drag_start = null;
        }
      }, e._get_private_properties = function(i) {
        var s = {};
        for (var _ in i)
          _.indexOf("_") === 0 && (s[_] = !0);
        return s;
      }, e._clear_temporary_properties = function(i, s) {
        var _ = this._get_private_properties(i), l = this._get_private_properties(s);
        for (var h in l)
          _[h] || delete s[h];
      }, e._on_mouse_up = function(i) {
        if (!i || i.button != 2 || !this._mobile) {
          if (this._drag_mode && this._drag_id) {
            this._els.dhx_cal_data[0].style.cursor = "default";
            var s = this._drag_id, _ = this._drag_mode, l = !this._drag_pos || this._drag_pos.has_moved;
            delete this._drag_event._move_event_shift;
            var h = this.getEvent(this._drag_id);
            if (l && (this._drag_event._dhx_changed || !this._drag_event.start_date || h.start_date.valueOf() != this._drag_event.start_date.valueOf() || h.end_date.valueOf() != this._drag_event.end_date.valueOf())) {
              var u = this._drag_mode == "new-size";
              if (this.callEvent("onBeforeEventChanged", [h, i, u, this._drag_event]))
                if (this._drag_id = this._drag_mode = null, u && this.config.edit_on_create) {
                  if (this.unselect(), this._new_event = /* @__PURE__ */ new Date(), this._table_view || this.config.details_on_create || !this.config.select || !this.isOneDayEvent(this.getEvent(s)))
                    return e.callEvent("onDragEnd", [s, _, i]), this.showLightbox(s);
                  this._drag_pos = !0, this._select_id = this._edit_id = s;
                } else
                  this._new_event || this.callEvent(u ? "onEventAdded" : "onEventChanged", [s, this.getEvent(s)]);
              else
                u ? this.deleteEvent(h.id, !0) : (this._drag_event._dhx_changed = !1, this._clear_temporary_properties(h, this._drag_event), e._lame_copy(h, this._drag_event), this.updateEvent(h.id));
            }
            this._drag_pos && (this._drag_pos.has_moved || this._drag_pos === !0) && (this._drag_id = this._drag_mode = null, this.render_view_data()), e.callEvent("onDragEnd", [s, _, i]);
          }
          this._drag_id = null, this._drag_mode = null, this._drag_pos = null, this._drag_event = null, this._drag_from_start = null;
        }
      }, e._trigger_dyn_loading = function() {
        return !(!this._load_mode || !this._load()) && (this._render_wait = !0, !0);
      }, e.update_view = function() {
        this._reset_ignores(), this._update_nav_bar(this.config.header, this.$container.querySelector(".dhx_cal_navline"));
        var i = this[this._mode + "_view"];
        if (i ? i.call(this, !0) : this._reset_scale(), this._trigger_dyn_loading())
          return !0;
        this.render_view_data();
      }, e.isViewExists = function(i) {
        return !!(e[i + "_view"] || e.date[i + "_start"] && e.templates[i + "_date"] && e.templates[i + "_scale_date"]);
      }, e._set_aria_buttons_attrs = function() {
        for (var i = ["dhx_cal_next_button", "dhx_cal_prev_button", "dhx_cal_tab", "dhx_cal_today_button"], s = 0; s < i.length; s++)
          for (var _ = this._els[i[s]], l = 0; _ && l < _.length; l++) {
            var h = _[l].getAttribute("data-tab") || _[l].getAttribute("name"), u = this.locale.labels[i[s]];
            h && (u = this.locale.labels[h + "_tab"] || this.locale.labels[h] || u), i[s] == "dhx_cal_next_button" ? u = this.locale.labels.next : i[s] == "dhx_cal_prev_button" && (u = this.locale.labels.prev), this._waiAria.headerButtonsAttributes(_[l], u || "");
          }
      }, e.updateView = function(i, s) {
        if (!this.$container)
          throw new Error(`The scheduler is not initialized. 
 **scheduler.updateView** or **scheduler.setCurrentView** can be called only after **scheduler.init**`);
        i = i || this._date, s = s || this._mode;
        var _ = "dhx_cal_data";
        this.locale.labels.icon_form || (this.locale.labels.icon_form = this.locale.labels.icon_edit);
        var l = this._obj, h = "dhx_scheduler_" + this._mode, u = "dhx_scheduler_" + s;
        this._mode && l.className.indexOf(h) != -1 ? l.className = l.className.replace(h, u) : l.className += " " + u;
        var m, f = "dhx_multi_day", y = !(this._mode != s || !this.config.preserve_scroll) && this._els[_][0].scrollTop;
        this._els[f] && this._els[f][0] && (m = this._els[f][0].scrollTop), this[this._mode + "_view"] && s && this._mode != s && this[this._mode + "_view"](!1), this._close_not_saved(), this._els[f] && (this._els[f][0].parentNode.removeChild(this._els[f][0]), this._els[f] = null), this._mode = s, this._date = i, this._table_view = this._mode == "month", this._dy_shift = 0, this.update_view(), this._set_aria_buttons_attrs();
        var b = this._els.dhx_cal_tab;
        if (b)
          for (var c = 0; c < b.length; c++) {
            var g = b[c];
            g.getAttribute("data-tab") == this._mode || g.getAttribute("name") == this._mode + "_tab" ? (g.classList.add("active"), this._waiAria.headerToggleState(g, !0)) : (g.classList.remove("active"), this._waiAria.headerToggleState(g, !1));
          }
        typeof y == "number" && (this._els[_][0].scrollTop = y), typeof m == "number" && this._els[f] && this._els[f][0] && (this._els[f][0].scrollTop = m);
      }, e.setCurrentView = function(i, s) {
        this.callEvent("onBeforeViewChange", [this._mode, this._date, s || this._mode, i || this._date]) && (this.updateView(i, s), this.callEvent("onViewChange", [this._mode, this._date]));
      }, e.render = function(i, s) {
        e.setCurrentView(i, s);
      }, e._render_x_header = function(i, s, _, l, h) {
        h = h || 0;
        var u = document.createElement("div");
        u.className = "dhx_scale_bar", this.templates[this._mode + "_scalex_class"] && (u.className += " " + this.templates[this._mode + "_scalex_class"](_));
        var m = this._cols[i];
        this._mode == "month" && i === 0 && this.config.left_border && (u.className += " dhx_scale_bar_border", s += 1), this.set_xy(u, m, this.xy.scale_height - 1, s, h);
        var f = this.templates[this._mode + "_scale_date"](_, this._mode);
        u.innerHTML = f, this._waiAria.dayHeaderAttr(u, f), l.appendChild(u);
      }, e._get_columns_num = function(i, s) {
        var _ = 7;
        if (!e._table_view) {
          var l = e.date["get_" + e._mode + "_end"];
          l && (s = l(i)), _ = Math.round((s.valueOf() - i.valueOf()) / 864e5);
        }
        return _;
      }, e._get_timeunit_start = function() {
        return this.date[this._mode + "_start"](new Date(this._date.valueOf()));
      }, e._get_view_end = function() {
        var i = this._get_timeunit_start(), s = e.date.add(i, 1, this._mode);
        if (!e._table_view) {
          var _ = e.date["get_" + e._mode + "_end"];
          _ && (s = _(i));
        }
        return s;
      }, e._calc_scale_sizes = function(i, s, _) {
        var l = this.config.rtl, h = i, u = this._get_columns_num(s, _);
        this._process_ignores(s, u, "day", 1);
        for (var m = u - this._ignores_detected, f = 0; f < u; f++)
          this._ignores[f] ? (this._cols[f] = 0, m++) : this._cols[f] = Math.floor(h / (m - f)), h -= this._cols[f], this._colsS[f] = (this._cols[f - 1] || 0) + (this._colsS[f - 1] || (this._table_view ? 0 : l ? this.xy.scroll_width : this.xy.scale_width));
        this._colsS.col_length = u, this._colsS[u] = this._cols[u - 1] + this._colsS[u - 1] || 0;
      }, e._set_scale_col_size = function(i, s, _) {
        var l = this.config;
        this.set_xy(i, s, l.hour_size_px * (l.last_hour - l.first_hour), _ + this.xy.scale_width + 1, 0);
      }, e._render_scales = function(i, s) {
        var _ = new Date(e._min_date), l = new Date(e._max_date), h = this.date.date_part(e._currentDate()), u = parseInt(i.style.width, 10) - 1, m = new Date(this._min_date), f = this._get_columns_num(_, l);
        this._calc_scale_sizes(u, _, l);
        var y = 0;
        i.innerHTML = "";
        for (var b = 0; b < f; b++) {
          if (this._ignores[b] || this._render_x_header(b, y, m, i), !this._table_view) {
            var c = document.createElement("div"), g = "dhx_scale_holder";
            m.valueOf() == h.valueOf() && (g += " dhx_scale_holder_now"), c.setAttribute("data-column-index", b), this._ignores_detected && this._ignores[b] && (g += " dhx_scale_ignore");
            for (let v = 1 * this.config.first_hour; v < this.config.last_hour; v++) {
              const p = document.createElement("div");
              p.className = "dhx_scale_time_slot dhx_scale_time_slot_hour_start", p.style.height = this.config.hour_size_px / 2 + "px";
              let x = new Date(m.getFullYear(), m.getMonth(), m.getDate(), v, 0);
              p.setAttribute("data-slot-date", this.templates.format_date(x));
              let w = this.templates.time_slot_text(x);
              w && (p.innerHTML = w);
              let k = this.templates.time_slot_class(x);
              k && p.classList.add(k), c.appendChild(p);
              const E = document.createElement("div");
              E.className = "dhx_scale_time_slot", x = new Date(m.getFullYear(), m.getMonth(), m.getDate(), v, 30), E.setAttribute("data-slot-date", this.templates.format_date(x)), E.style.height = this.config.hour_size_px / 2 + "px", w = this.templates.time_slot_text(x), w && (E.innerHTML = w), k = this.templates.time_slot_class(x), k && E.classList.add(k), c.appendChild(E);
            }
            c.className = g + " " + this.templates.week_date_class(m, h), this._waiAria.dayColumnAttr(c, m), this._set_scale_col_size(c, this._cols[b], y), s.appendChild(c), this.callEvent("onScaleAdd", [c, m]);
          }
          y += this._cols[b], m = this.date.add(m, 1, "day"), m = this.date.day_start(m);
        }
      }, e._getNavDateElement = function() {
        return this.$container.querySelector(".dhx_cal_date");
      }, e._reset_scale = function() {
        if (this.templates[this._mode + "_date"]) {
          var i = this._els.dhx_cal_header[0], s = this._els.dhx_cal_data[0], _ = this.config;
          i.innerHTML = "", s.innerHTML = "";
          var l, h, u = (_.readonly || !_.drag_resize ? " dhx_resize_denied" : "") + (_.readonly || !_.drag_move ? " dhx_move_denied" : "");
          s.className = "dhx_cal_data" + u, this._scales = {}, this._cols = [], this._colsS = { height: 0 }, this._dy_shift = 0, this.set_sizes();
          var m = this._get_timeunit_start(), f = e._get_view_end();
          l = h = this._table_view ? e.date.week_start(m) : m, this._min_date = l;
          var y = this.templates[this._mode + "_date"](m, f, this._mode), b = this._getNavDateElement();
          if (b && (b.innerHTML = y, this._waiAria.navBarDateAttr(b, y)), this._max_date = f, e._render_scales(i, s), this._table_view)
            this._reset_month_scale(s, m, h);
          else if (this._reset_hours_scale(s, m, h), _.multi_day) {
            var c = "dhx_multi_day";
            this._els[c] && (this._els[c][0].parentNode.removeChild(this._els[c][0]), this._els[c] = null);
            var g = document.createElement("div");
            g.className = c, g.style.visibility = "hidden", g.style.display = "none";
            var v = this._colsS[this._colsS.col_length], p = _.rtl ? this.xy.scale_width : this.xy.scroll_width, x = Math.max(v + p, 0);
            this.set_xy(g, x, 0, 0), s.parentNode.insertBefore(g, s);
            var w = g.cloneNode(!0);
            w.className = c + "_icon", w.style.visibility = "hidden", w.style.display = "none", this.set_xy(w, this.xy.scale_width + 1, 0, 0), g.appendChild(w), this._els[c] = [g, w], e.event(this._els[c][0], "click", this._click.dhx_cal_data);
          }
        }
      }, e._reset_hours_scale = function(i, s, _) {
        var l = document.createElement("div");
        l.className = "dhx_scale_holder";
        for (var h = new Date(1980, 1, 1, this.config.first_hour, 0, 0), u = 1 * this.config.first_hour; u < this.config.last_hour; u++) {
          var m = document.createElement("div");
          m.className = "dhx_scale_hour", m.style.height = this.config.hour_size_px + "px";
          var f = this.xy.scale_width;
          this.config.left_border && (m.className += " dhx_scale_hour_border"), m.style.width = f + "px";
          var y = e.templates.hour_scale(h);
          m.innerHTML = y, this._waiAria.hourScaleAttr(m, y), l.appendChild(m), h = this.date.add(h, 1, "hour");
        }
        i.appendChild(l), this.config.scroll_hour && (i.scrollTop = this.config.hour_size_px * (this.config.scroll_hour - this.config.first_hour));
      }, e._currentDate = function() {
        return e.config.now_date ? new Date(e.config.now_date) : /* @__PURE__ */ new Date();
      }, e._reset_ignores = function() {
        this._ignores = {}, this._ignores_detected = 0;
      }, e._process_ignores = function(i, s, _, l, h) {
        this._reset_ignores();
        var u = e["ignore_" + this._mode];
        if (u)
          for (var m = new Date(i), f = 0; f < s; f++)
            u(m) && (this._ignores_detected += 1, this._ignores[f] = !0, h && s++), m = e.date.add(m, l, _), e.date[_ + "_start"] && (m = e.date[_ + "_start"](m));
      }, e._render_month_scale = function(i, s, _, l) {
        var h = e.date.add(s, 1, "month"), u = new Date(_), m = e._currentDate();
        this.date.date_part(m), this.date.date_part(_), l = l || Math.ceil(Math.round((h.valueOf() - _.valueOf()) / 864e5) / 7);
        for (var f = [], y = 0; y <= 7; y++) {
          var b = this._cols[y] || 0;
          isNaN(Number(b)) || (b += "px"), f[y] = b;
        }
        function c(M) {
          var C = e._colsS.height;
          return e._colsS.heights[M + 1] !== void 0 && (C = e._colsS.heights[M + 1] - (e._colsS.heights[M] || 0)), C;
        }
        var g = 0;
        const v = document.createElement("div");
        for (v.classList.add("dhx_cal_month_table"), y = 0; y < l; y++) {
          var p = document.createElement("div");
          p.classList.add("dhx_cal_month_row"), p.style.height = c(y) + "px", v.appendChild(p);
          for (var x = 0; x < 7; x++) {
            var w = document.createElement("div");
            p.appendChild(w);
            var k = "dhx_cal_month_cell";
            _ < s ? k += " dhx_before" : _ >= h ? k += " dhx_after" : _.valueOf() == m.valueOf() && (k += " dhx_now"), this._ignores_detected && this._ignores[x] && (k += " dhx_scale_ignore"), w.className = k + " " + this.templates.month_date_class(_, m), w.setAttribute("data-cell-date", e.templates.format_date(_));
            var E = "dhx_month_body", D = "dhx_month_head";
            if (x === 0 && this.config.left_border && (E += " dhx_month_body_border", D += " dhx_month_head_border"), this._ignores_detected && this._ignores[x])
              w.appendChild(document.createElement("div")), w.appendChild(document.createElement("div"));
            else {
              w.style.width = f[x], this._waiAria.monthCellAttr(w, _);
              var S = document.createElement("div");
              S.style.height = e.xy.month_head_height + "px", S.className = D, S.innerHTML = this.templates.month_day(_), w.appendChild(S);
              var N = document.createElement("div");
              N.className = E, w.appendChild(N);
            }
            var A = _.getDate();
            (_ = this.date.add(_, 1, "day")).getDate() - A > 1 && (_ = new Date(_.getFullYear(), _.getMonth(), A + 1, 12, 0));
          }
          e._colsS.heights[y] = g, g += c(y);
        }
        return this._min_date = u, this._max_date = _, i.innerHTML = "", i.appendChild(v), this._scales = {}, i.querySelectorAll("[data-cell-date]").forEach((M) => {
          const C = e.templates.parse_date(M.getAttribute("data-cell-date")), T = M.querySelector(".dhx_month_body");
          this._scales[+C] = T, this.callEvent("onScaleAdd", [this._scales[+C], C]);
        }), this._max_date;
      }, e._reset_month_scale = function(i, s, _, l) {
        var h = e.date.add(s, 1, "month"), u = e._currentDate();
        this.date.date_part(u), this.date.date_part(_), l = l || Math.ceil(Math.round((h.valueOf() - _.valueOf()) / 864e5) / 7);
        var m = Math.floor(i.clientHeight / l) - this.xy.month_head_height;
        return this._colsS.height = m + this.xy.month_head_height, this._colsS.heights = [], e._render_month_scale(i, s, _, l);
      }, e.getView = function(i) {
        return i || (i = e.getState().mode), e.matrix && e.matrix[i] ? e.matrix[i] : e._props && e._props[i] ? e._props[i] : null;
      }, e.getLabel = function(i, s) {
        for (var _ = this.config.lightbox.sections, l = 0; l < _.length; l++)
          if (_[l].map_to == i) {
            for (var h = _[l].options, u = 0; u < h.length; u++)
              if (h[u].key == s)
                return h[u].label;
          }
        return "";
      }, e.updateCollection = function(i, s) {
        var _ = e.serverList(i);
        return !!_ && (_.splice(0, _.length), _.push.apply(_, s || []), e.callEvent("onOptionsLoad", []), e.resetLightbox(), e.hideCover(), !0);
      }, e._lame_clone = function(i, s) {
        var _, l, h;
        for (s = s || [], _ = 0; _ < s.length; _ += 2)
          if (i === s[_])
            return s[_ + 1];
        if (i && typeof i == "object") {
          for (h = Object.create(i), l = [Array, Date, Number, String, Boolean], _ = 0; _ < l.length; _++)
            i instanceof l[_] && (h = _ ? new l[_](i) : new l[_]());
          for (_ in s.push(i, h), i)
            Object.prototype.hasOwnProperty.apply(i, [_]) && (h[_] = e._lame_clone(i[_], s));
        }
        return h || i;
      }, e._lame_copy = function(i, s) {
        for (var _ in s)
          s.hasOwnProperty(_) && (i[_] = s[_]);
        return i;
      }, e._get_date_from_pos = function(i) {
        var s = this._min_date.valueOf() + 6e4 * (i.y * this.config.time_step + 24 * (this._table_view ? 0 : i.x) * 60);
        return new Date(this._correct_shift(s));
      }, e.getActionData = function(i) {
        var s = this._mouse_coords(i);
        return { date: this._get_date_from_pos(s), section: s.section };
      }, e._focus = function(i, s) {
        if (i && i.focus)
          if (this._mobile)
            window.setTimeout(function() {
              i.focus();
            }, 10);
          else
            try {
              s && i.select && i.offsetWidth && i.select(), i.focus();
            } catch {
            }
      }, e._get_real_event_length = function(i, s, _) {
        var l, h = s - i, u = this["ignore_" + this._mode], m = 0;
        _.render ? (m = this._get_date_index(_, i), l = this._get_date_index(_, s), i.valueOf() < e.getState().min_date.valueOf() && (m = -d(i, e.getState().min_date)), s.valueOf() > e.getState().max_date.valueOf() && (l += d(s, e.getState().max_date))) : l = Math.round(h / 60 / 60 / 1e3 / 24);
        for (var f = !0; m < l; ) {
          var y = e.date.add(s, -_.x_step, _.x_unit);
          if (u && u(s) && (!f || f && u(y)))
            h -= s - y;
          else {
            let b = 0;
            const c = new Date(Math.max(y.valueOf(), i.valueOf())), g = s, v = new Date(c.getFullYear(), c.getMonth(), c.getDate(), _.first_hour), p = new Date(c.getFullYear(), c.getMonth(), c.getDate(), _.last_hour), x = new Date(s.getFullYear(), s.getMonth(), s.getDate(), _.first_hour), w = new Date(s.getFullYear(), s.getMonth(), s.getDate(), _.last_hour);
            g.valueOf() > w.valueOf() && (b += g - w), g.valueOf() > x.valueOf() ? b += _._start_correction : b += 60 * g.getHours() * 60 * 1e3 + 60 * g.getMinutes() * 1e3, c.valueOf() < p.valueOf() && (b += _._end_correction), c.valueOf() < v.valueOf() && (b += v.valueOf() - c.valueOf()), h -= b, f = !1;
          }
          s = y, l--;
        }
        return h;
      }, e._get_fictional_event_length = function(i, s, _, l) {
        var h = new Date(i), u = l ? -1 : 1;
        if (_._start_correction || _._end_correction) {
          var m;
          m = l ? 60 * h.getHours() + h.getMinutes() - 60 * (_.first_hour || 0) : 60 * (_.last_hour || 0) - (60 * h.getHours() + h.getMinutes());
          var f = 60 * (_.last_hour - _.first_hour), y = Math.ceil((s / 6e4 - m) / f);
          y < 0 && (y = 0), s += y * (1440 - f) * 60 * 1e3;
        }
        var b, c = new Date(1 * i + s * u), g = this["ignore_" + this._mode], v = 0;
        for (_.render ? (v = this._get_date_index(_, h), b = this._get_date_index(_, c)) : b = Math.round(s / 60 / 60 / 1e3 / 24); v * u <= b * u; ) {
          var p = e.date.add(h, _.x_step * u, _.x_unit);
          g && g(h) && (s += (p - h) * u, b += u), h = p, v += u;
        }
        return s;
      }, e._get_section_view = function() {
        return this.getView();
      }, e._get_section_property = function() {
        return this.matrix && this.matrix[this._mode] ? this.matrix[this._mode].y_property : this._props && this._props[this._mode] ? this._props[this._mode].map_to : null;
      }, e._is_initialized = function() {
        var i = this.getState();
        return this._obj && i.date && i.mode;
      }, e._is_lightbox_open = function() {
        var i = this.getState();
        return i.lightbox_id !== null && i.lightbox_id !== void 0;
      };
    }
    const defaultDomEvents = { event: function(e, a, t) {
      e.addEventListener ? e.addEventListener(a, t, !1) : e.attachEvent && e.attachEvent("on" + a, t);
    }, eventRemove: function(e, a, t) {
      e.removeEventListener ? e.removeEventListener(a, t, !1) : e.detachEvent && e.detachEvent("on" + a, t);
    } };
    function createEventScope() {
      var e = function(a, t) {
        a = a || defaultDomEvents.event, t = t || defaultDomEvents.eventRemove;
        var n = [], o = { attach: function(r, d, i, s) {
          n.push({ element: r, event: d, callback: i, capture: s }), a(r, d, i, s);
        }, detach: function(r, d, i, s) {
          t(r, d, i, s);
          for (var _ = 0; _ < n.length; _++) {
            var l = n[_];
            l.element === r && l.event === d && l.callback === i && l.capture === s && (n.splice(_, 1), _--);
          }
        }, detachAll: function() {
          for (var r = n.slice(), d = 0; d < r.length; d++) {
            var i = r[d];
            o.detach(i.element, i.event, i.callback, i.capture), o.detach(i.element, i.event, i.callback, void 0), o.detach(i.element, i.event, i.callback, !1), o.detach(i.element, i.event, i.callback, !0);
          }
          n.splice(0, n.length);
        }, extend: function() {
          return e(this.event, this.eventRemove);
        } };
        return o;
      };
      return e();
    }
    function extend$k(e) {
      var a = createEventScope();
      e.event = a.attach, e.eventRemove = a.detach, e._eventRemoveAll = a.detachAll, e._createDomEventScope = a.extend, e._trim = function(t) {
        return (String.prototype.trim || function() {
          return this.replace(/^\s+|\s+$/g, "");
        }).apply(t);
      }, e._isDate = function(t) {
        return !(!t || typeof t != "object") && !!(t.getFullYear && t.getMonth && t.getDate);
      }, e._isObject = function(t) {
        return t && typeof t == "object";
      };
    }
    function extend$j(e) {
      (function() {
        var a = new RegExp(`<(?:.|
)*?>`, "gm"), t = new RegExp(" +", "gm");
        function n(i) {
          return (i + "").replace(a, " ").replace(t, " ");
        }
        var o = new RegExp("'", "gm");
        function r(i) {
          return (i + "").replace(o, "&#39;");
        }
        for (var d in e._waiAria = { getAttributeString: function(i) {
          var s = [" "];
          for (var _ in i)
            if (typeof i[_] != "function" && typeof i[_] != "object") {
              var l = r(n(i[_]));
              s.push(_ + "='" + l + "'");
            }
          return s.push(" "), s.join(" ");
        }, setAttributes: function(i, s) {
          for (var _ in s)
            i.setAttribute(_, n(s[_]));
          return i;
        }, labelAttr: function(i, s) {
          return this.setAttributes(i, { "aria-label": s });
        }, label: function(i) {
          return e._waiAria.getAttributeString({ "aria-label": i });
        }, hourScaleAttr: function(i, s) {
          this.labelAttr(i, s);
        }, monthCellAttr: function(i, s) {
          this.labelAttr(i, e.templates.day_date(s));
        }, navBarDateAttr: function(i, s) {
          this.labelAttr(i, s);
        }, dayHeaderAttr: function(i, s) {
          this.labelAttr(i, s);
        }, dayColumnAttr: function(i, s) {
          this.dayHeaderAttr(i, e.templates.day_date(s));
        }, headerButtonsAttributes: function(i, s) {
          return this.setAttributes(i, { role: "button", "aria-label": s });
        }, headerToggleState: function(i, s) {
          return this.setAttributes(i, { "aria-pressed": s ? "true" : "false" });
        }, getHeaderCellAttr: function(i) {
          return e._waiAria.getAttributeString({ "aria-label": i });
        }, eventAttr: function(i, s) {
          this._eventCommonAttr(i, s);
        }, _eventCommonAttr: function(i, s) {
          s.setAttribute("aria-label", n(e.templates.event_text(i.start_date, i.end_date, i))), e.config.readonly && s.setAttribute("aria-readonly", !0), i.$dataprocessor_class && s.setAttribute("aria-busy", !0), s.setAttribute("aria-selected", e.getState().select_id == i.id ? "true" : "false");
        }, setEventBarAttr: function(i, s) {
          this._eventCommonAttr(i, s);
        }, _getAttributes: function(i, s) {
          var _ = { setAttribute: function(l, h) {
            this[l] = h;
          } };
          return i.apply(this, [s, _]), _;
        }, eventBarAttrString: function(i) {
          return this.getAttributeString(this._getAttributes(this.setEventBarAttr, i));
        }, agendaHeadAttrString: function() {
          return this.getAttributeString({ role: "row" });
        }, agendaHeadDateString: function(i) {
          return this.getAttributeString({ role: "columnheader", "aria-label": i });
        }, agendaHeadDescriptionString: function(i) {
          return this.agendaHeadDateString(i);
        }, agendaDataAttrString: function() {
          return this.getAttributeString({ role: "grid" });
        }, agendaEventAttrString: function(i) {
          var s = this._getAttributes(this._eventCommonAttr, i);
          return s.role = "row", this.getAttributeString(s);
        }, agendaDetailsBtnString: function() {
          return this.getAttributeString({ role: "button", "aria-label": e.locale.labels.icon_details });
        }, gridAttrString: function() {
          return this.getAttributeString({ role: "grid" });
        }, gridRowAttrString: function(i) {
          return this.agendaEventAttrString(i);
        }, gridCellAttrString: function(i, s, _) {
          return this.getAttributeString({ role: "gridcell", "aria-label": [s.label === void 0 ? s.id : s.label, ": ", _] });
        }, mapAttrString: function() {
          return this.gridAttrString();
        }, mapRowAttrString: function(i) {
          return this.gridRowAttrString(i);
        }, mapDetailsBtnString: function() {
          return this.agendaDetailsBtnString();
        }, minicalHeader: function(i, s) {
          this.setAttributes(i, { id: s + "", "aria-live": "assertice", "aria-atomic": "true" });
        }, minicalGrid: function(i, s) {
          this.setAttributes(i, { "aria-labelledby": s + "", role: "grid" });
        }, minicalRow: function(i) {
          this.setAttributes(i, { role: "row" });
        }, minicalDayCell: function(i, s) {
          var _ = s.valueOf() < e._max_date.valueOf() && s.valueOf() >= e._min_date.valueOf();
          this.setAttributes(i, { role: "gridcell", "aria-label": e.templates.day_date(s), "aria-selected": _ ? "true" : "false" });
        }, minicalHeadCell: function(i) {
          this.setAttributes(i, { role: "columnheader" });
        }, weekAgendaDayCell: function(i, s) {
          var _ = i.querySelector(".dhx_wa_scale_bar"), l = i.querySelector(".dhx_wa_day_data"), h = e.uid() + "";
          this.setAttributes(_, { id: h }), this.setAttributes(l, { "aria-labelledby": h });
        }, weekAgendaEvent: function(i, s) {
          this.eventAttr(s, i);
        }, lightboxHiddenAttr: function(i) {
          i.setAttribute("aria-hidden", "true");
        }, lightboxVisibleAttr: function(i) {
          i.setAttribute("aria-hidden", "false");
        }, lightboxSectionButtonAttrString: function(i) {
          return this.getAttributeString({ role: "button", "aria-label": i, tabindex: "0" });
        }, yearHeader: function(i, s) {
          this.setAttributes(i, { id: s + "" });
        }, yearGrid: function(i, s) {
          this.minicalGrid(i, s);
        }, yearHeadCell: function(i) {
          return this.minicalHeadCell(i);
        }, yearRow: function(i) {
          return this.minicalRow(i);
        }, yearDayCell: function(i) {
          this.setAttributes(i, { role: "gridcell" });
        }, lightboxAttr: function(i) {
          i.setAttribute("role", "dialog"), i.setAttribute("aria-hidden", "true"), i.firstChild.setAttribute("role", "heading");
        }, lightboxButtonAttrString: function(i) {
          return this.getAttributeString({ role: "button", "aria-label": e.locale.labels[i], tabindex: "0" });
        }, eventMenuAttrString: function(i) {
          return this.getAttributeString({ role: "button", "aria-label": e.locale.labels[i] });
        }, lightboxHeader: function(i, s) {
          i.setAttribute("aria-label", s);
        }, lightboxSelectAttrString: function(i) {
          var s = "";
          switch (i) {
            case "%Y":
              s = e.locale.labels.year;
              break;
            case "%m":
              s = e.locale.labels.month;
              break;
            case "%d":
              s = e.locale.labels.day;
              break;
            case "%H:%i":
              s = e.locale.labels.hour + " " + e.locale.labels.minute;
          }
          return e._waiAria.getAttributeString({ "aria-label": s });
        }, messageButtonAttrString: function(i) {
          return "tabindex='0' role='button' aria-label='" + i + "'";
        }, messageInfoAttr: function(i) {
          i.setAttribute("role", "alert");
        }, messageModalAttr: function(i, s) {
          i.setAttribute("role", "dialog"), s && i.setAttribute("aria-labelledby", s);
        }, quickInfoAttr: function(i) {
          i.setAttribute("role", "dialog");
        }, quickInfoHeaderAttrString: function() {
          return " role='heading' ";
        }, quickInfoHeader: function(i, s) {
          i.setAttribute("aria-label", s);
        }, quickInfoButtonAttrString: function(i) {
          return e._waiAria.getAttributeString({ role: "button", "aria-label": i, tabindex: "0" });
        }, tooltipAttr: function(i) {
          i.setAttribute("role", "tooltip");
        }, tooltipVisibleAttr: function(i) {
          i.setAttribute("aria-hidden", "false");
        }, tooltipHiddenAttr: function(i) {
          i.setAttribute("aria-hidden", "true");
        } }, e._waiAria)
          e._waiAria[d] = function(i) {
            return function() {
              return e.config.wai_aria_attributes ? i.apply(this, arguments) : " ";
            };
          }(e._waiAria[d]);
      })();
    }
    var uidSeed = Date.now();
    function uid() {
      return uidSeed++;
    }
    function isArray(e) {
      return Array.isArray ? Array.isArray(e) : e && e.length !== void 0 && e.pop && e.push;
    }
    function isStringObject(e) {
      return e && typeof e == "object" && Function.prototype.toString.call(e.constructor) === "function String() { [native code] }";
    }
    function isNumberObject(e) {
      return e && typeof e == "object" && Function.prototype.toString.call(e.constructor) === "function Number() { [native code] }";
    }
    function isBooleanObject(e) {
      return e && typeof e == "object" && Function.prototype.toString.call(e.constructor) === "function Boolean() { [native code] }";
    }
    function isDate(e) {
      return !(!e || typeof e != "object") && !!(e.getFullYear && e.getMonth && e.getDate);
    }
    function defined(e) {
      return e !== void 0;
    }
    function delay(e, a) {
      var t, n = function() {
        n.$cancelTimeout(), n.$pending = !0;
        var o = Array.prototype.slice.call(arguments);
        t = setTimeout(function() {
          e.apply(this, o), n.$pending = !1;
        }, a);
      };
      return n.$pending = !1, n.$cancelTimeout = function() {
        clearTimeout(t), n.$pending = !1;
      }, n.$execute = function() {
        var o = Array.prototype.slice.call(arguments);
        e.apply(this, o), n.$cancelTimeout();
      }, n;
    }
    const utils = { uid, mixin: function(e, a, t) {
      for (var n in a)
        (e[n] === void 0 || t) && (e[n] = a[n]);
      return e;
    }, copy: function e(a) {
      var t, n;
      if (a && typeof a == "object")
        switch (!0) {
          case isDate(a):
            n = new Date(a);
            break;
          case isArray(a):
            for (n = new Array(a.length), t = 0; t < a.length; t++)
              n[t] = e(a[t]);
            break;
          case isStringObject(a):
            n = new String(a);
            break;
          case isNumberObject(a):
            n = new Number(a);
            break;
          case isBooleanObject(a):
            n = new Boolean(a);
            break;
          default:
            for (t in n = {}, a) {
              const o = typeof a[t];
              o === "string" || o === "number" || o === "boolean" ? n[t] = a[t] : isDate(a[t]) ? n[t] = new Date(a[t]) : Object.prototype.hasOwnProperty.apply(a, [t]) && (n[t] = e(a[t]));
            }
        }
      return n || a;
    }, defined, isDate, delay };
    function elementPosition(e) {
      var a = 0, t = 0, n = 0, o = 0;
      if (e.getBoundingClientRect) {
        var r = e.getBoundingClientRect(), d = document.body, i = document.documentElement || document.body.parentNode || document.body, s = window.pageYOffset || i.scrollTop || d.scrollTop, _ = window.pageXOffset || i.scrollLeft || d.scrollLeft, l = i.clientTop || d.clientTop || 0, h = i.clientLeft || d.clientLeft || 0;
        a = r.top + s - l, t = r.left + _ - h, n = document.body.offsetWidth - r.right, o = document.body.offsetHeight - r.bottom;
      } else {
        for (; e; )
          a += parseInt(e.offsetTop, 10), t += parseInt(e.offsetLeft, 10), e = e.offsetParent;
        n = document.body.offsetWidth - e.offsetWidth - t, o = document.body.offsetHeight - e.offsetHeight - a;
      }
      return { y: Math.round(a), x: Math.round(t), width: e.offsetWidth, height: e.offsetHeight, right: Math.round(n), bottom: Math.round(o) };
    }
    function getRelativeEventPosition(e, a) {
      var t = document.documentElement, n = elementPosition(a);
      return { x: e.clientX + t.scrollLeft - t.clientLeft - n.x + a.scrollLeft, y: e.clientY + t.scrollTop - t.clientTop - n.y + a.scrollTop };
    }
    function getNodePosition(e) {
      var a = 0, t = 0, n = 0, o = 0;
      if (e.getBoundingClientRect) {
        var r = e.getBoundingClientRect(), d = document.body, i = document.documentElement || document.body.parentNode || document.body, s = window.pageYOffset || i.scrollTop || d.scrollTop, _ = window.pageXOffset || i.scrollLeft || d.scrollLeft, l = i.clientTop || d.clientTop || 0, h = i.clientLeft || d.clientLeft || 0;
        a = r.top + s - l, t = r.left + _ - h, n = document.body.offsetWidth - r.right, o = document.body.offsetHeight - r.bottom;
      } else {
        for (; e; )
          a += parseInt(e.offsetTop, 10), t += parseInt(e.offsetLeft, 10), e = e.offsetParent;
        n = document.body.offsetWidth - e.offsetWidth - t, o = document.body.offsetHeight - e.offsetHeight - a;
      }
      return { y: Math.round(a), x: Math.round(t), width: e.offsetWidth, height: e.offsetHeight, right: Math.round(n), bottom: Math.round(o) };
    }
    function getClassName(e) {
      if (!e)
        return "";
      var a = e.className || "";
      return a.baseVal && (a = a.baseVal), a.indexOf || (a = ""), a || "";
    }
    function getTargetNode(e) {
      var a;
      return e.tagName ? a = e : (a = (e = e || window.event).target || e.srcElement).shadowRoot && e.composedPath && (a = e.composedPath()[0]), a;
    }
    function locateCss(e, a, t) {
      t === void 0 && (t = !0);
      for (var n = e.target || e.srcElement, o = ""; n; ) {
        if (o = getClassName(n)) {
          var r = o.indexOf(a);
          if (r >= 0) {
            if (!t)
              return n;
            var d = r === 0 || !(o.charAt(r - 1) || "").trim(), i = r + a.length >= o.length || !o.charAt(r + a.length).trim();
            if (d && i)
              return n;
          }
        }
        n = n.parentNode;
      }
      return null;
    }
    function isVisible(e) {
      var a = !1, t = !1;
      if (window.getComputedStyle) {
        var n = window.getComputedStyle(e, null);
        a = n.display, t = n.visibility;
      } else
        e.currentStyle && (a = e.currentStyle.display, t = e.currentStyle.visibility);
      var o = !1, r = locateCss({ target: e }, "dhx_form_repeat", !1);
      return r && (o = r.style.height == "0px"), o = o || !e.offsetHeight, a != "none" && t != "hidden" && !o;
    }
    function hasNonNegativeTabIndex(e) {
      return !isNaN(e.getAttribute("tabindex")) && 1 * e.getAttribute("tabindex") >= 0;
    }
    function hasHref(e) {
      return !{ a: !0, area: !0 }[e.nodeName.loLowerCase()] || !!e.getAttribute("href");
    }
    function isEnabled(e) {
      return !{ input: !0, select: !0, textarea: !0, button: !0, object: !0 }[e.nodeName.toLowerCase()] || !e.hasAttribute("disabled");
    }
    function getFocusableNodes(e) {
      for (var a = e.querySelectorAll(["a[href]", "area[href]", "input", "select", "textarea", "button", "iframe", "object", "embed", "[tabindex]", "[contenteditable]"].join(", ")), t = Array.prototype.slice.call(a, 0), n = 0; n < t.length; n++)
        t[n].$position = n;
      for (t.sort(function(r, d) {
        return r.tabIndex === 0 && d.tabIndex !== 0 ? 1 : r.tabIndex !== 0 && d.tabIndex === 0 ? -1 : r.tabIndex === d.tabIndex ? r.$position - d.$position : r.tabIndex < d.tabIndex ? -1 : 1;
      }), n = 0; n < t.length; n++) {
        var o = t[n];
        (hasNonNegativeTabIndex(o) || isEnabled(o) || hasHref(o)) && isVisible(o) || (t.splice(n, 1), n--);
      }
      return t;
    }
    function isShadowDomSupported() {
      return document.head.createShadowRoot || document.head.attachShadow;
    }
    function getActiveElement() {
      var e = document.activeElement;
      return e.shadowRoot && (e = e.shadowRoot.activeElement), e === document.body && document.getSelection && (e = document.getSelection().focusNode || document.body), e;
    }
    function getRootNode(e) {
      if (!e || !isShadowDomSupported())
        return document.body;
      for (; e.parentNode && (e = e.parentNode); )
        if (e instanceof ShadowRoot)
          return e.host;
      return document.body;
    }
    function hasShadowParent(e) {
      return !!getRootNode(e);
    }
    const dom_helpers = { getAbsoluteLeft: function(e) {
      return this.getOffset(e).left;
    }, getAbsoluteTop: function(e) {
      return this.getOffset(e).top;
    }, getOffsetSum: function(e) {
      for (var a = 0, t = 0; e; )
        a += parseInt(e.offsetTop), t += parseInt(e.offsetLeft), e = e.offsetParent;
      return { top: a, left: t };
    }, getOffsetRect: function(e) {
      var a = e.getBoundingClientRect(), t = 0, n = 0;
      if (/Mobi/.test(navigator.userAgent)) {
        var o = document.createElement("div");
        o.style.position = "absolute", o.style.left = "0px", o.style.top = "0px", o.style.width = "1px", o.style.height = "1px", document.body.appendChild(o);
        var r = o.getBoundingClientRect();
        t = a.top - r.top, n = a.left - r.left, o.parentNode.removeChild(o);
      } else {
        var d = document.body, i = document.documentElement, s = window.pageYOffset || i.scrollTop || d.scrollTop, _ = window.pageXOffset || i.scrollLeft || d.scrollLeft, l = i.clientTop || d.clientTop || 0, h = i.clientLeft || d.clientLeft || 0;
        t = a.top + s - l, n = a.left + _ - h;
      }
      return { top: Math.round(t), left: Math.round(n) };
    }, getOffset: function(e) {
      return e.getBoundingClientRect ? this.getOffsetRect(e) : this.getOffsetSum(e);
    }, closest: function(e, a) {
      return e && a ? closest(e, a) : null;
    }, insertAfter: function(e, a) {
      a.nextSibling ? a.parentNode.insertBefore(e, a.nextSibling) : a.parentNode.appendChild(e);
    }, remove: function(e) {
      e && e.parentNode && e.parentNode.removeChild(e);
    }, isChildOf: function(e, a) {
      return a.contains(e);
    }, getFocusableNodes, getClassName, locateCss, getRootNode, hasShadowParent, isShadowDomSupported, getActiveElement, getRelativeEventPosition, getTargetNode, getNodePosition };
    var closest;
    if (Element.prototype.closest)
      closest = function(e, a) {
        return e.closest(a);
      };
    else {
      var matches = Element.prototype.matches || Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
      closest = function(e, a) {
        var t = e;
        do {
          if (matches.call(t, a))
            return t;
          t = t.parentElement || t.parentNode;
        } while (t !== null && t.nodeType === 1);
        return null;
      };
    }
    var isWindowAwailable = typeof window < "u";
    const env = { isIE: isWindowAwailable && (navigator.userAgent.indexOf("MSIE") >= 0 || navigator.userAgent.indexOf("Trident") >= 0), isIE6: isWindowAwailable && !XMLHttpRequest && navigator.userAgent.indexOf("MSIE") >= 0, isIE7: isWindowAwailable && navigator.userAgent.indexOf("MSIE 7.0") >= 0 && navigator.userAgent.indexOf("Trident") < 0, isIE8: isWindowAwailable && navigator.userAgent.indexOf("MSIE 8.0") >= 0 && navigator.userAgent.indexOf("Trident") >= 0, isOpera: isWindowAwailable && navigator.userAgent.indexOf("Opera") >= 0, isChrome: isWindowAwailable && navigator.userAgent.indexOf("Chrome") >= 0, isKHTML: isWindowAwailable && (navigator.userAgent.indexOf("Safari") >= 0 || navigator.userAgent.indexOf("Konqueror") >= 0), isFF: isWindowAwailable && navigator.userAgent.indexOf("Firefox") >= 0, isIPad: isWindowAwailable && navigator.userAgent.search(/iPad/gi) >= 0, isEdge: isWindowAwailable && navigator.userAgent.indexOf("Edge") != -1, isNode: !isWindowAwailable || typeof navigator > "u" };
    function extend$i(e) {
      e.destructor = function() {
        for (var a in e.callEvent("onDestroy", []), this.clearAll(), this.$container && (this.$container.innerHTML = ""), this._eventRemoveAll && this._eventRemoveAll(), this.resetLightbox && this.resetLightbox(), this._dp && this._dp.destructor && this._dp.destructor(), this.detachAllEvents(), this)
          a.indexOf("$") === 0 && delete this[a];
        e.$destroyed = !0;
      };
    }
    function serialize$1(e) {
      if (typeof e == "string" || typeof e == "number")
        return e;
      var a = "";
      for (var t in e) {
        var n = "";
        e.hasOwnProperty(t) && (n = t + "=" + (n = typeof e[t] == "string" ? encodeURIComponent(e[t]) : typeof e[t] == "number" ? e[t] : encodeURIComponent(JSON.stringify(e[t]))), a.length && (n = "&" + n), a += n);
      }
      return a;
    }
    function extend$h(e) {
      function a(t, n) {
        var o = { method: t };
        if (n.length === 0)
          throw new Error("Arguments list of query is wrong.");
        if (n.length === 1)
          return typeof n[0] == "string" ? (o.url = n[0], o.async = !0) : (o.url = n[0].url, o.async = n[0].async || !0, o.callback = n[0].callback, o.headers = n[0].headers), n[0].data ? typeof n[0].data != "string" ? o.data = serialize$1(n[0].data) : o.data = n[0].data : o.data = "", o;
        switch (o.url = n[0], t) {
          case "GET":
          case "DELETE":
            o.callback = n[1], o.headers = n[2];
            break;
          case "POST":
          case "PUT":
            n[1] ? typeof n[1] != "string" ? o.data = serialize$1(n[1]) : o.data = n[1] : o.data = "", o.callback = n[2], o.headers = n[3];
        }
        return o;
      }
      e.Promise = window.Promise, e.ajax = { cache: !0, method: "get", serializeRequestParams: serialize$1, parse: function(t) {
        return typeof t != "string" ? t : (t = t.replace(/^[\s]+/, ""), typeof DOMParser > "u" || e.$env.isIE ? window.ActiveXObject !== void 0 && ((n = new window.ActiveXObject("Microsoft.XMLDOM")).async = "false", n.loadXML(t)) : n = new DOMParser().parseFromString(t, "text/xml"), n);
        var n;
      }, xmltop: function(t, n, o) {
        if (n.status === void 0 || n.status < 400) {
          var r = n.responseXML ? n.responseXML || n : this.parse(n.responseText || n);
          if (r && r.documentElement !== null && !r.getElementsByTagName("parsererror").length)
            return r.getElementsByTagName(t)[0];
        }
        return o !== -1 && e.callEvent("onLoadXMLError", ["Incorrect XML", arguments[1], o]), document.createElement("DIV");
      }, xpath: function(t, n) {
        if (n.nodeName || (n = n.responseXML || n), e.$env.isIE)
          return n.selectNodes(t) || [];
        for (var o, r = [], d = (n.ownerDocument || n).evaluate(t, n, null, XPathResult.ANY_TYPE, null); o = d.iterateNext(); )
          r.push(o);
        return r;
      }, query: function(t) {
        return this._call(t.method || "GET", t.url, t.data || "", t.async || !0, t.callback, t.headers);
      }, get: function(t, n, o) {
        var r = a("GET", arguments);
        return this.query(r);
      }, getSync: function(t, n) {
        var o = a("GET", arguments);
        return o.async = !1, this.query(o);
      }, put: function(t, n, o, r) {
        var d = a("PUT", arguments);
        return this.query(d);
      }, del: function(t, n, o) {
        var r = a("DELETE", arguments);
        return this.query(r);
      }, post: function(t, n, o, r) {
        arguments.length == 1 ? n = "" : arguments.length == 2 && typeof n == "function" && (o = n, n = "");
        var d = a("POST", arguments);
        return this.query(d);
      }, postSync: function(t, n, o) {
        n = n === null ? "" : String(n);
        var r = a("POST", arguments);
        return r.async = !1, this.query(r);
      }, _call: function(t, n, o, r, d, i) {
        return new e.Promise((function(s, _) {
          var l = typeof XMLHttpRequest === void 0 || e.$env.isIE ? new window.ActiveXObject("Microsoft.XMLHTTP") : new XMLHttpRequest(), h = navigator.userAgent.match(/AppleWebKit/) !== null && navigator.userAgent.match(/Qt/) !== null && navigator.userAgent.match(/Safari/) !== null;
          if (r && l.addEventListener("readystatechange", function() {
            if (l.readyState == 4 || h && l.readyState == 3) {
              if ((l.status != 200 || l.responseText === "") && !e.callEvent("onAjaxError", [l]))
                return;
              setTimeout(function() {
                typeof d == "function" && d.apply(window, [{ xmlDoc: l, filePath: n }]), s(l), typeof d == "function" && (d = null, l = null);
              }, 0);
            }
          }), t != "GET" || this.cache || (n += (n.indexOf("?") >= 0 ? "&" : "?") + "dhxr" + (/* @__PURE__ */ new Date()).getTime() + "=1"), l.open(t, n, r), i)
            for (var u in i)
              l.setRequestHeader(u, i[u]);
          else
            t.toUpperCase() == "POST" || t == "PUT" || t == "DELETE" ? l.setRequestHeader("Content-Type", "application/x-www-form-urlencoded") : t == "GET" && (o = null);
          if (l.setRequestHeader("X-Requested-With", "XMLHttpRequest"), l.send(o), !r)
            return { xmlDoc: l, filePath: n };
        }).bind(this));
      }, urlSeparator: function(t) {
        return t.indexOf("?") != -1 ? "&" : "?";
      } }, e.$ajax = e.ajax;
    }
    function extend$g(e) {
      var a = function(r, d) {
        for (var i = "var temp=date.match(/[a-zA-Z]+|[0-9]+/g);", s = r.match(/%[a-zA-Z]/g), _ = 0; _ < s.length; _++)
          switch (s[_]) {
            case "%j":
            case "%d":
              i += "set[2]=temp[" + _ + "]||1;";
              break;
            case "%n":
            case "%m":
              i += "set[1]=(temp[" + _ + "]||1)-1;";
              break;
            case "%y":
              i += "set[0]=temp[" + _ + "]*1+(temp[" + _ + "]>50?1900:2000);";
              break;
            case "%g":
            case "%G":
            case "%h":
            case "%H":
              i += "set[3]=temp[" + _ + "]||0;";
              break;
            case "%i":
              i += "set[4]=temp[" + _ + "]||0;";
              break;
            case "%Y":
              i += "set[0]=temp[" + _ + "]||0;";
              break;
            case "%a":
            case "%A":
              i += "set[3]=set[3]%12+((temp[" + _ + "]||'').toLowerCase()=='am'?0:12);";
              break;
            case "%s":
              i += "set[5]=temp[" + _ + "]||0;";
              break;
            case "%M":
              i += "set[1]=this.locale.date.month_short_hash[temp[" + _ + "]]||0;";
              break;
            case "%F":
              i += "set[1]=this.locale.date.month_full_hash[temp[" + _ + "]]||0;";
          }
        var l = "set[0],set[1],set[2],set[3],set[4],set[5]";
        return d && (l = " Date.UTC(" + l + ")"), new Function("date", "var set=[0,0,1,0,0,0]; " + i + " return new Date(" + l + ");");
      }, t = function(r, d) {
        return function(i) {
          for (var s = [0, 0, 1, 0, 0, 0], _ = i.match(/[a-zA-Z]+|[0-9]+/g), l = r.match(/%[a-zA-Z]/g), h = 0; h < l.length; h++)
            switch (l[h]) {
              case "%j":
              case "%d":
                s[2] = _[h] || 1;
                break;
              case "%n":
              case "%m":
                s[1] = (_[h] || 1) - 1;
                break;
              case "%y":
                s[0] = 1 * _[h] + (_[h] > 50 ? 1900 : 2e3);
                break;
              case "%g":
              case "%G":
              case "%h":
              case "%H":
                s[3] = _[h] || 0;
                break;
              case "%i":
                s[4] = _[h] || 0;
                break;
              case "%Y":
                s[0] = _[h] || 0;
                break;
              case "%a":
              case "%A":
                s[3] = s[3] % 12 + ((_[h] || "").toLowerCase() == "am" ? 0 : 12);
                break;
              case "%s":
                s[5] = _[h] || 0;
                break;
              case "%M":
                s[1] = e.locale.date.month_short_hash[_[h]] || 0;
                break;
              case "%F":
                s[1] = e.locale.date.month_full_hash[_[h]] || 0;
            }
          return d ? new Date(Date.UTC(s[0], s[1], s[2], s[3], s[4], s[5])) : new Date(s[0], s[1], s[2], s[3], s[4], s[5]);
        };
      }, n = !1;
      function o() {
        return e.config.csp === "auto" ? n : e.config.csp;
      }
      ((function() {
        try {
          new Function("canUseCsp = false;");
        } catch {
          n = !0;
        }
      }))(), e.date = { init: function() {
        for (var r = e.locale.date.month_short, d = e.locale.date.month_short_hash = {}, i = 0; i < r.length; i++)
          d[r[i]] = i;
        for (r = e.locale.date.month_full, d = e.locale.date.month_full_hash = {}, i = 0; i < r.length; i++)
          d[r[i]] = i;
      }, _bind_host_object: function(r) {
        return r.bind ? r.bind(e) : function() {
          return r.apply(e, arguments);
        };
      }, date_part: function(r) {
        var d = new Date(r);
        return r.setHours(0), r.setMinutes(0), r.setSeconds(0), r.setMilliseconds(0), r.getHours() && (r.getDate() < d.getDate() || r.getMonth() < d.getMonth() || r.getFullYear() < d.getFullYear()) && r.setTime(r.getTime() + 36e5 * (24 - r.getHours())), r;
      }, time_part: function(r) {
        return (r.valueOf() / 1e3 - 60 * r.getTimezoneOffset()) % 86400;
      }, week_start: function(r) {
        var d = r.getDay();
        return e.config.start_on_monday && (d === 0 ? d = 6 : d--), this.date_part(this.add(r, -1 * d, "day"));
      }, month_start: function(r) {
        return r.setDate(1), this.date_part(r);
      }, year_start: function(r) {
        return r.setMonth(0), this.month_start(r);
      }, day_start: function(r) {
        return this.date_part(r);
      }, _add_days: function(r, d) {
        var i = new Date(r.valueOf());
        if (i.setDate(i.getDate() + d), d == Math.round(d) && d > 0) {
          var s = (+i - +r) % 864e5;
          if (s && r.getTimezoneOffset() == i.getTimezoneOffset()) {
            var _ = s / 36e5;
            i.setTime(i.getTime() + 60 * (24 - _) * 60 * 1e3);
          }
        }
        return d >= 0 && !r.getHours() && i.getHours() && (i.getDate() < r.getDate() || i.getMonth() < r.getMonth() || i.getFullYear() < r.getFullYear()) && i.setTime(i.getTime() + 36e5 * (24 - i.getHours())), i;
      }, add: function(r, d, i) {
        var s = new Date(r.valueOf());
        switch (i) {
          case "day":
            s = e.date._add_days(s, d);
            break;
          case "week":
            s = e.date._add_days(s, 7 * d);
            break;
          case "month":
            s.setMonth(s.getMonth() + d);
            break;
          case "year":
            s.setYear(s.getFullYear() + d);
            break;
          case "hour":
            s.setTime(s.getTime() + 60 * d * 60 * 1e3);
            break;
          case "minute":
            s.setTime(s.getTime() + 60 * d * 1e3);
            break;
          default:
            return e.date["add_" + i](r, d, i);
        }
        return s;
      }, to_fixed: function(r) {
        return r < 10 ? "0" + r : r;
      }, copy: function(r) {
        return new Date(r.valueOf());
      }, date_to_str: function(r, d) {
        if (o())
          return function(s, _) {
            return function(l) {
              return s.replace(/%[a-zA-Z]/g, function(h) {
                switch (h) {
                  case "%d":
                    return _ ? e.date.to_fixed(l.getUTCDate()) : e.date.to_fixed(l.getDate());
                  case "%m":
                    return _ ? e.date.to_fixed(l.getUTCMonth() + 1) : e.date.to_fixed(l.getMonth() + 1);
                  case "%j":
                    return _ ? l.getUTCDate() : l.getDate();
                  case "%n":
                    return _ ? l.getUTCMonth() + 1 : l.getMonth() + 1;
                  case "%y":
                    return _ ? e.date.to_fixed(l.getUTCFullYear() % 100) : e.date.to_fixed(l.getFullYear() % 100);
                  case "%Y":
                    return _ ? l.getUTCFullYear() : l.getFullYear();
                  case "%D":
                    return _ ? e.locale.date.day_short[l.getUTCDay()] : e.locale.date.day_short[l.getDay()];
                  case "%l":
                    return _ ? e.locale.date.day_full[l.getUTCDay()] : e.locale.date.day_full[l.getDay()];
                  case "%M":
                    return _ ? e.locale.date.month_short[l.getUTCMonth()] : e.locale.date.month_short[l.getMonth()];
                  case "%F":
                    return _ ? e.locale.date.month_full[l.getUTCMonth()] : e.locale.date.month_full[l.getMonth()];
                  case "%h":
                    return _ ? e.date.to_fixed((l.getUTCHours() + 11) % 12 + 1) : e.date.to_fixed((l.getHours() + 11) % 12 + 1);
                  case "%g":
                    return _ ? (l.getUTCHours() + 11) % 12 + 1 : (l.getHours() + 11) % 12 + 1;
                  case "%G":
                    return _ ? l.getUTCHours() : l.getHours();
                  case "%H":
                    return _ ? e.date.to_fixed(l.getUTCHours()) : e.date.to_fixed(l.getHours());
                  case "%i":
                    return _ ? e.date.to_fixed(l.getUTCMinutes()) : e.date.to_fixed(l.getMinutes());
                  case "%a":
                    return _ ? l.getUTCHours() > 11 ? "pm" : "am" : l.getHours() > 11 ? "pm" : "am";
                  case "%A":
                    return _ ? l.getUTCHours() > 11 ? "PM" : "AM" : l.getHours() > 11 ? "PM" : "AM";
                  case "%s":
                    return _ ? e.date.to_fixed(l.getUTCSeconds()) : e.date.to_fixed(l.getSeconds());
                  case "%W":
                    return _ ? e.date.to_fixed(e.date.getUTCISOWeek(l)) : e.date.to_fixed(e.date.getISOWeek(l));
                  default:
                    return h;
                }
              });
            };
          }(r, d);
        r = r.replace(/%[a-zA-Z]/g, function(s) {
          switch (s) {
            case "%d":
              return '"+this.date.to_fixed(date.getDate())+"';
            case "%m":
              return '"+this.date.to_fixed((date.getMonth()+1))+"';
            case "%j":
              return '"+date.getDate()+"';
            case "%n":
              return '"+(date.getMonth()+1)+"';
            case "%y":
              return '"+this.date.to_fixed(date.getFullYear()%100)+"';
            case "%Y":
              return '"+date.getFullYear()+"';
            case "%D":
              return '"+this.locale.date.day_short[date.getDay()]+"';
            case "%l":
              return '"+this.locale.date.day_full[date.getDay()]+"';
            case "%M":
              return '"+this.locale.date.month_short[date.getMonth()]+"';
            case "%F":
              return '"+this.locale.date.month_full[date.getMonth()]+"';
            case "%h":
              return '"+this.date.to_fixed((date.getHours()+11)%12+1)+"';
            case "%g":
              return '"+((date.getHours()+11)%12+1)+"';
            case "%G":
              return '"+date.getHours()+"';
            case "%H":
              return '"+this.date.to_fixed(date.getHours())+"';
            case "%i":
              return '"+this.date.to_fixed(date.getMinutes())+"';
            case "%a":
              return '"+(date.getHours()>11?"pm":"am")+"';
            case "%A":
              return '"+(date.getHours()>11?"PM":"AM")+"';
            case "%s":
              return '"+this.date.to_fixed(date.getSeconds())+"';
            case "%W":
              return '"+this.date.to_fixed(this.date.getISOWeek(date))+"';
            default:
              return s;
          }
        }), d && (r = r.replace(/date\.get/g, "date.getUTC"));
        var i = new Function("date", 'return "' + r + '";');
        return e.date._bind_host_object(i);
      }, str_to_date: function(r, d, i) {
        var s = o() ? t : a, _ = s(r, d), l = /^[0-9]{4}(\-|\/)[0-9]{2}(\-|\/)[0-9]{2} ?(([0-9]{1,2}:[0-9]{1,2})(:[0-9]{1,2})?)?$/, h = /^[0-9]{2}\/[0-9]{2}\/[0-9]{4} ?(([0-9]{1,2}:[0-9]{2})(:[0-9]{1,2})?)?$/, u = /^[0-9]{2}\-[0-9]{2}\-[0-9]{4} ?(([0-9]{1,2}:[0-9]{1,2})(:[0-9]{1,2})?)?$/, m = /^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-2])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24\:?00)([\.,]\d+(?!:))?)?(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/, f = s("%Y-%m-%d %H:%i:%s", d), y = s("%m/%d/%Y %H:%i:%s", d), b = s("%d-%m-%Y %H:%i:%s", d);
        return function(c) {
          if (!i && !e.config.parse_exact_format) {
            if (c && c.getISOWeek)
              return new Date(c);
            if (typeof c == "number")
              return new Date(c);
            if (g = c, l.test(String(g)))
              return f(c);
            if (function(v) {
              return h.test(String(v));
            }(c))
              return y(c);
            if (function(v) {
              return u.test(String(v));
            }(c))
              return b(c);
            if (function(v) {
              return m.test(v);
            }(c))
              return new Date(c);
          }
          var g;
          return _.call(e, c);
        };
      }, getISOWeek: function(r) {
        if (!r)
          return !1;
        var d = (r = this.date_part(new Date(r))).getDay();
        d === 0 && (d = 7);
        var i = new Date(r.valueOf());
        i.setDate(r.getDate() + (4 - d));
        var s = i.getFullYear(), _ = Math.round((i.getTime() - new Date(s, 0, 1).getTime()) / 864e5);
        return 1 + Math.floor(_ / 7);
      }, getUTCISOWeek: function(r) {
        return this.getISOWeek(this.convert_to_utc(r));
      }, convert_to_utc: function(r) {
        return new Date(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate(), r.getUTCHours(), r.getUTCMinutes(), r.getUTCSeconds());
      } };
    }
    function extend$f(e) {
      e.config = { default_date: "%j %M %Y", month_date: "%F %Y", load_date: "%Y-%m-%d", week_date: "%l", day_date: "%D %j", hour_date: "%H:%i", month_day: "%d", date_format: "%Y-%m-%d %H:%i", api_date: "%d-%m-%Y %H:%i", parse_exact_format: !1, preserve_length: !0, time_step: 5, displayed_event_color: "#ff4a4a", displayed_event_text_color: "#ffef80", wide_form: 0, day_column_padding: 8, use_select_menu_space: !0, fix_tab_position: !0, start_on_monday: !0, first_hour: 0, last_hour: 24, readonly: !1, drag_resize: !0, drag_move: !0, drag_create: !0, drag_event_body: !0, dblclick_create: !0, details_on_dblclick: !0, edit_on_create: !0, details_on_create: !0, header: null, hour_size_px: 44, resize_month_events: !1, resize_month_timed: !1, responsive_lightbox: !1, separate_short_events: !0, rtl: !1, cascade_event_display: !1, cascade_event_count: 4, cascade_event_margin: 30, multi_day: !0, multi_day_height_limit: 200, drag_lightbox: !0, preserve_scroll: !0, select: !0, server_utc: !1, touch: !0, touch_tip: !0, touch_drag: 500, touch_swipe_dates: !1, quick_info_detached: !0, positive_closing: !1, drag_highlight: !0, limit_drag_out: !1, icons_edit: ["icon_save", "icon_cancel"], icons_select: ["icon_details", "icon_edit", "icon_delete"], buttons_left: ["dhx_save_btn", "dhx_cancel_btn"], buttons_right: ["dhx_delete_btn"], lightbox: { sections: [{ name: "description", map_to: "text", type: "textarea", focus: !0 }, { name: "time", height: 72, type: "time", map_to: "auto" }] }, highlight_displayed_event: !0, left_border: !1, ajax_error: "alert", delay_render: 0, timeline_swap_resize: !0, wai_aria_attributes: !0, wai_aria_application_role: !0, csp: "auto", event_attribute: "data-event-id", show_errors: !0 }, e.config.buttons_left.$initial = e.config.buttons_left.join(), e.config.buttons_right.$initial = e.config.buttons_right.join(), e._helpers = { parseDate: function(a) {
        return (e.templates.xml_date || e.templates.parse_date)(a);
      }, formatDate: function(a) {
        return (e.templates.xml_format || e.templates.format_date)(a);
      } }, e.templates = {}, e.init_templates = function() {
        var a = e.date.date_to_str, t = e.config;
        ((function(n, o) {
          for (var r in o)
            n[r] || (n[r] = o[r]);
        }))(e.templates, { day_date: a(t.default_date), month_date: a(t.month_date), week_date: function(n, o) {
          return t.rtl ? e.templates.day_date(e.date.add(o, -1, "day")) + " &ndash; " + e.templates.day_date(n) : e.templates.day_date(n) + " &ndash; " + e.templates.day_date(e.date.add(o, -1, "day"));
        }, day_scale_date: a(t.default_date), time_slot_text: function(n) {
          return "";
        }, time_slot_class: function(n) {
          return "";
        }, month_scale_date: a(t.week_date), week_scale_date: a(t.day_date), hour_scale: a(t.hour_date), time_picker: a(t.hour_date), event_date: a(t.hour_date), month_day: a(t.month_day), load_format: a(t.load_date), format_date: a(t.date_format, t.server_utc), parse_date: e.date.str_to_date(t.date_format, t.server_utc), api_date: e.date.str_to_date(t.api_date, !1, !1), event_header: function(n, o, r) {
          return r._mode === "small" || r._mode === "smallest" ? e.templates.event_date(n) : e.templates.event_date(n) + " - " + e.templates.event_date(o);
        }, event_text: function(n, o, r) {
          return r.text;
        }, event_class: function(n, o, r) {
          return "";
        }, month_date_class: function(n) {
          return "";
        }, week_date_class: function(n) {
          return "";
        }, event_bar_date: function(n, o, r) {
          return e.templates.event_date(n);
        }, event_bar_text: function(n, o, r) {
          return r.text;
        }, month_events_link: function(n, o) {
          return "<a>View more(" + o + " events)</a>";
        }, drag_marker_class: function(n, o, r) {
          return "";
        }, drag_marker_content: function(n, o, r) {
          return "";
        }, tooltip_date_format: e.date.date_to_str("%Y-%m-%d %H:%i"), tooltip_text: function(n, o, r) {
          return "<b>Event:</b> " + r.text + "<br/><b>Start date:</b> " + e.templates.tooltip_date_format(n) + "<br/><b>End date:</b> " + e.templates.tooltip_date_format(o);
        }, calendar_month: a("%F %Y"), calendar_scale_date: a("%D"), calendar_date: a("%d"), calendar_time: a("%d-%m-%Y") }), this.callEvent("onTemplatesReady", []);
      };
    }
    function extend$e(e) {
      e._events = {}, e.clearAll = function() {
        this._events = {}, this._loaded = {}, this._edit_id = null, this._select_id = null, this._drag_id = null, this._drag_mode = null, this._drag_pos = null, this._new_event = null, this.clear_view(), this.callEvent("onClearAll", []);
      }, e.addEvent = function(a, t, n, o, r) {
        if (!arguments.length)
          return this.addEventNow();
        var d = a;
        arguments.length != 1 && ((d = r || {}).start_date = a, d.end_date = t, d.text = n, d.id = o), d.id = d.id || e.uid(), d.text = d.text || "", typeof d.start_date == "string" && (d.start_date = this.templates.api_date(d.start_date)), typeof d.end_date == "string" && (d.end_date = this.templates.api_date(d.end_date));
        var i = 6e4 * (this.config.event_duration || this.config.time_step);
        d.start_date.valueOf() == d.end_date.valueOf() && d.end_date.setTime(d.end_date.valueOf() + i), d.start_date.setMilliseconds(0), d.end_date.setMilliseconds(0), d._timed = this.isOneDayEvent(d);
        var s = !this._events[d.id];
        return this._events[d.id] = d, this.event_updated(d), this._loading || this.callEvent(s ? "onEventAdded" : "onEventChanged", [d.id, d]), d.id;
      }, e.deleteEvent = function(a, t) {
        var n = this._events[a];
        (t || this.callEvent("onBeforeEventDelete", [a, n]) && this.callEvent("onConfirmedBeforeEventDelete", [a, n])) && (n && (e.getState().select_id == a && e.unselect(), delete this._events[a], this.event_updated(n), this._drag_id == n.id && (this._drag_id = null, this._drag_mode = null, this._drag_pos = null)), this.callEvent("onEventDeleted", [a, n]));
      }, e.getEvent = function(a) {
        return this._events[a];
      }, e.setEvent = function(a, t) {
        t.id || (t.id = a), this._events[a] = t;
      }, e.for_rendered = function(a, t) {
        for (var n = this._rendered.length - 1; n >= 0; n--)
          this._rendered[n].getAttribute(this.config.event_attribute) == a && t(this._rendered[n], n);
      }, e.changeEventId = function(a, t) {
        if (a != t) {
          var n = this._events[a];
          n && (n.id = t, this._events[t] = n, delete this._events[a]), this.for_rendered(a, function(o) {
            o.setAttribute("event_id", t), o.setAttribute(e.config.event_attribute, t);
          }), this._select_id == a && (this._select_id = t), this._edit_id == a && (this._edit_id = t), this.callEvent("onEventIdChange", [a, t]);
        }
      }, function() {
        for (var a = ["text", "Text", "start_date", "StartDate", "end_date", "EndDate"], t = function(r) {
          return function(d) {
            return e.getEvent(d)[r];
          };
        }, n = function(r) {
          return function(d, i) {
            var s = e.getEvent(d);
            s[r] = i, s._changed = !0, s._timed = this.isOneDayEvent(s), e.event_updated(s, !0);
          };
        }, o = 0; o < a.length; o += 2)
          e["getEvent" + a[o + 1]] = t(a[o]), e["setEvent" + a[o + 1]] = n(a[o]);
      }(), e.event_updated = function(a, t) {
        this.is_visible_events(a) ? this.render_view_data() : this.clear_event(a.id);
      }, e.is_visible_events = function(a) {
        if (!this._min_date || !this._max_date)
          return !1;
        if (a.start_date.valueOf() < this._max_date.valueOf() && this._min_date.valueOf() < a.end_date.valueOf()) {
          var t = a.start_date.getHours(), n = a.end_date.getHours() + a.end_date.getMinutes() / 60, o = this.config.last_hour, r = this.config.first_hour;
          return !!(this._table_view || !((n > o || n <= r) && (t >= o || t < r))) || (a.end_date.valueOf() - a.start_date.valueOf()) / 36e5 > 24 - (this.config.last_hour - this.config.first_hour) || t < o && n > r;
        }
        return !1;
      }, e.isOneDayEvent = function(a) {
        var t = new Date(a.end_date.valueOf() - 1);
        return a.start_date.getFullYear() === t.getFullYear() && a.start_date.getMonth() === t.getMonth() && a.start_date.getDate() === t.getDate() && a.end_date.valueOf() - a.start_date.valueOf() < 864e5;
      }, e.get_visible_events = function(a) {
        var t = [];
        for (var n in this._events)
          this.is_visible_events(this._events[n]) && (a && !this._events[n]._timed || this.filter_event(n, this._events[n]) && t.push(this._events[n]));
        return t;
      }, e.filter_event = function(a, t) {
        var n = this["filter_" + this._mode];
        return !n || n(a, t);
      }, e._is_main_area_event = function(a) {
        return !!a._timed;
      }, e.render_view_data = function(a, t) {
        var n = !1;
        if (!a) {
          if (n = !0, this._not_render)
            return void (this._render_wait = !0);
          this._render_wait = !1, this.clear_view(), a = this.get_visible_events(!(this._table_view || this.config.multi_day));
        }
        for (var o = 0, r = a.length; o < r; o++)
          this._recalculate_timed(a[o]);
        if (this.config.multi_day && !this._table_view) {
          var d = [], i = [];
          for (o = 0; o < a.length; o++)
            this._is_main_area_event(a[o]) ? d.push(a[o]) : i.push(a[o]);
          if (!this._els.dhx_multi_day) {
            var s = e._commonErrorMessages.unknownView(this._mode);
            throw new Error(s);
          }
          this._rendered_location = this._els.dhx_multi_day[0], this._table_view = !0, this.render_data(i, t), this._table_view = !1, this._rendered_location = this._els.dhx_cal_data[0], this._table_view = !1, this.render_data(d, t);
        } else {
          var _ = document.createDocumentFragment(), l = this._els.dhx_cal_data[0];
          this._rendered_location = _, this.render_data(a, t), l.appendChild(_), this._rendered_location = l;
        }
        n && this.callEvent("onDataRender", []);
      }, e._view_month_day = function(a) {
        var t = e.getActionData(a).date;
        e.callEvent("onViewMoreClick", [t]) && e.setCurrentView(t, "day");
      }, e._render_month_link = function(a) {
        for (var t = this._rendered_location, n = this._lame_clone(a), o = a._sday; o < a._eday; o++) {
          n._sday = o, n._eday = o + 1;
          var r = e.date, d = e._min_date;
          d = r.add(d, n._sweek, "week"), d = r.add(d, n._sday, "day");
          var i = e.getEvents(d, r.add(d, 1, "day")).length, s = this._get_event_bar_pos(n), _ = s.x2 - s.x, l = document.createElement("div");
          e.event(l, "click", function(h) {
            e._view_month_day(h);
          }), l.className = "dhx_month_link", l.style.top = s.y + "px", l.style.left = s.x + "px", l.style.width = _ + "px", l.innerHTML = e.templates.month_events_link(d, i), this._rendered.push(l), t.appendChild(l);
        }
      }, e._recalculate_timed = function(a) {
        var t;
        a && (t = typeof a != "object" ? this._events[a] : a) && (t._timed = e.isOneDayEvent(t));
      }, e.attachEvent("onEventChanged", e._recalculate_timed), e.attachEvent("onEventAdded", e._recalculate_timed), e.render_data = function(a, t) {
        a = this._pre_render_events(a, t);
        for (var n = {}, o = 0; o < a.length; o++)
          if (this._table_view)
            if (e._mode != "month")
              this.render_event_bar(a[o]);
            else {
              var r = e.config.max_month_events;
              r !== 1 * r || a[o]._sorder < r ? this.render_event_bar(a[o]) : r !== void 0 && a[o]._sorder == r && e._render_month_link(a[o]);
            }
          else {
            var d = a[o], i = e.locate_holder(d._sday);
            if (!i)
              continue;
            n[d._sday] || (n[d._sday] = { real: i, buffer: document.createDocumentFragment(), width: i.clientWidth });
            var s = n[d._sday];
            this.render_event(d, s.buffer, s.width);
          }
        for (var o in n)
          (s = n[o]).real && s.buffer && s.real.appendChild(s.buffer);
      }, e._get_first_visible_cell = function(a) {
        for (var t = 0; t < a.length; t++)
          if ((a[t].className || "").indexOf("dhx_scale_ignore") == -1)
            return a[t];
        return a[0];
      }, e._pre_render_events = function(a, t) {
        var n = this.xy.bar_height, o = this._colsS.heights, r = this._colsS.heights = [0, 0, 0, 0, 0, 0, 0], d = this._els.dhx_cal_data[0];
        if (a = this._table_view ? this._pre_render_events_table(a, t) : this._pre_render_events_line(a, t), this._table_view)
          if (t)
            this._colsS.heights = o;
          else {
            var i = d.querySelectorAll(".dhx_cal_month_row");
            if (i.length) {
              for (var s = 0; s < i.length; s++) {
                r[s]++;
                var _ = i[s].querySelectorAll(".dhx_cal_month_cell"), l = this._colsS.height - this.xy.month_head_height;
                if (r[s] * n > l) {
                  var h = l;
                  1 * this.config.max_month_events !== this.config.max_month_events || r[s] <= this.config.max_month_events ? h = r[s] * n : (this.config.max_month_events + 1) * n > l && (h = (this.config.max_month_events + 1) * n), i[s].style.height = h + this.xy.month_head_height + "px";
                }
                r[s] = (r[s - 1] || 0) + e._get_first_visible_cell(_).offsetHeight;
              }
              r.unshift(0);
              const p = this.$container.querySelector(".dhx_cal_data");
              if (p.offsetHeight < p.scrollHeight && !e._colsS.scroll_fix && e.xy.scroll_width) {
                var u = e._colsS, m = u[u.col_length], f = u.heights.slice();
                m -= e.xy.scroll_width || 0, this._calc_scale_sizes(m, this._min_date, this._max_date), e._colsS.heights = f, this.set_xy(this._els.dhx_cal_header[0], m), e._render_scales(this._els.dhx_cal_header[0]), e._render_month_scale(this._els.dhx_cal_data[0], this._get_timeunit_start(), this._min_date), u.scroll_fix = !0;
              }
            } else if (a.length || this._els.dhx_multi_day[0].style.visibility != "visible" || (r[0] = -1), a.length || r[0] == -1) {
              var y = (r[0] + 1) * n + 4, b = y, c = y + "px";
              this.config.multi_day_height_limit && (c = (b = Math.min(y, this.config.multi_day_height_limit)) + "px");
              var g = this._els.dhx_multi_day[0];
              g.style.height = c, g.style.visibility = r[0] == -1 ? "hidden" : "visible", g.style.display = r[0] == -1 ? "none" : "";
              var v = this._els.dhx_multi_day[1];
              v.style.height = c, v.style.visibility = r[0] == -1 ? "hidden" : "visible", v.style.display = r[0] == -1 ? "none" : "", v.className = r[0] ? "dhx_multi_day_icon" : "dhx_multi_day_icon_small", this._dy_shift = (r[0] + 1) * n, this.config.multi_day_height_limit && (this._dy_shift = Math.min(this.config.multi_day_height_limit, this._dy_shift)), r[0] = 0, b != y && (g.style.overflowY = "auto", v.style.position = "fixed", v.style.top = "", v.style.left = "");
            }
          }
        return a;
      }, e._get_event_sday = function(a) {
        var t = this.date.day_start(new Date(a.start_date));
        return Math.round((t.valueOf() - this._min_date.valueOf()) / 864e5);
      }, e._get_event_mapped_end_date = function(a) {
        var t = a.end_date;
        if (this.config.separate_short_events) {
          var n = (a.end_date - a.start_date) / 6e4;
          n < this._min_mapped_duration && (t = this.date.add(t, this._min_mapped_duration - n, "minute"));
        }
        return t;
      }, e._pre_render_events_line = function(a, t) {
        a.sort(function(v, p) {
          return v.start_date.valueOf() == p.start_date.valueOf() ? v.id > p.id ? 1 : -1 : v.start_date > p.start_date ? 1 : -1;
        });
        var n = [], o = [];
        this._min_mapped_duration = Math.floor(60 * this.xy.min_event_height / this.config.hour_size_px);
        for (var r = 0; r < a.length; r++) {
          var d = a[r], i = d.start_date, s = d.end_date, _ = i.getHours(), l = s.getHours();
          if (d._sday = this._get_event_sday(d), this._ignores[d._sday])
            a.splice(r, 1), r--;
          else {
            if (n[d._sday] || (n[d._sday] = []), !t) {
              d._inner = !1;
              for (var h = n[d._sday]; h.length; ) {
                var u = h[h.length - 1];
                if (!(this._get_event_mapped_end_date(u).valueOf() <= d.start_date.valueOf()))
                  break;
                h.splice(h.length - 1, 1);
              }
              for (var m = h.length, f = !1, y = 0; y < h.length; y++)
                if (u = h[y], this._get_event_mapped_end_date(u).valueOf() <= d.start_date.valueOf()) {
                  f = !0, d._sorder = u._sorder, m = y, d._inner = !0;
                  break;
                }
              if (h.length && (h[h.length - 1]._inner = !0), !f)
                if (h.length)
                  if (h.length <= h[h.length - 1]._sorder) {
                    if (h[h.length - 1]._sorder)
                      for (y = 0; y < h.length; y++) {
                        for (var b = !1, c = 0; c < h.length; c++)
                          if (h[c]._sorder == y) {
                            b = !0;
                            break;
                          }
                        if (!b) {
                          d._sorder = y;
                          break;
                        }
                      }
                    else
                      d._sorder = 0;
                    d._inner = !0;
                  } else {
                    var g = h[0]._sorder;
                    for (y = 1; y < h.length; y++)
                      h[y]._sorder > g && (g = h[y]._sorder);
                    d._sorder = g + 1, d._inner = !1;
                  }
                else
                  d._sorder = 0;
              h.splice(m, m == h.length ? 0 : 1, d), h.length > (h.max_count || 0) ? (h.max_count = h.length, d._count = h.length) : d._count = d._count ? d._count : 1;
            }
            (_ < this.config.first_hour || l >= this.config.last_hour) && (o.push(d), a[r] = d = this._copy_event(d), _ < this.config.first_hour && (d.start_date.setHours(this.config.first_hour), d.start_date.setMinutes(0)), l >= this.config.last_hour && (d.end_date.setMinutes(0), d.end_date.setHours(this.config.last_hour)), d.start_date > d.end_date || _ == this.config.last_hour) && (a.splice(r, 1), r--);
          }
        }
        if (!t) {
          for (r = 0; r < a.length; r++)
            a[r]._count = n[a[r]._sday].max_count;
          for (r = 0; r < o.length; r++)
            o[r]._count = n[o[r]._sday].max_count;
        }
        return a;
      }, e._time_order = function(a) {
        a.sort(function(t, n) {
          return t.start_date.valueOf() == n.start_date.valueOf() ? t._timed && !n._timed ? 1 : !t._timed && n._timed ? -1 : t.id > n.id ? 1 : -1 : t.start_date > n.start_date ? 1 : -1;
        });
      }, e._is_any_multiday_cell_visible = function(a, t, n) {
        var o = this._cols.length, r = !1, d = a, i = !0, s = new Date(t);
        for (e.date.day_start(new Date(t)).valueOf() != t.valueOf() && (s = e.date.day_start(s), s = e.date.add(s, 1, "day")); d < s; ) {
          i = !1;
          var _ = this.locate_holder_day(d, !1, n) % o;
          if (!this._ignores[_]) {
            r = !0;
            break;
          }
          d = e.date.add(d, 1, "day");
        }
        return i || r;
      }, e._pre_render_events_table = function(a, t) {
        this._time_order(a);
        for (var n, o = [], r = [[], [], [], [], [], [], []], d = this._colsS.heights, i = this._cols.length, s = {}, _ = 0; _ < a.length; _++) {
          var l = a[_], h = l.id;
          s[h] || (s[h] = { first_chunk: !0, last_chunk: !0 });
          var u = s[h], m = n || l.start_date, f = l.end_date;
          m < this._min_date && (u.first_chunk = !1, m = this._min_date), f > this._max_date && (u.last_chunk = !1, f = this._max_date);
          var y = this.locate_holder_day(m, !1, l);
          if (l._sday = y % i, !this._ignores[l._sday] || !l._timed) {
            var b = this.locate_holder_day(f, !0, l) || i;
            if (l._eday = b % i || i, l._length = b - y, l._sweek = Math.floor((this._correct_shift(m.valueOf(), 1) - this._min_date.valueOf()) / (864e5 * i)), e._is_any_multiday_cell_visible(m, f, l)) {
              var c, g = r[l._sweek];
              for (c = 0; c < g.length && !(g[c]._eday <= l._sday); c++)
                ;
              if (l._sorder && t || (l._sorder = c), l._sday + l._length <= i)
                n = null, o.push(l), g[c] = l, d[l._sweek] = g.length - 1, l._first_chunk = u.first_chunk, l._last_chunk = u.last_chunk;
              else {
                var v = this._copy_event(l);
                v.id = l.id, v._length = i - l._sday, v._eday = i, v._sday = l._sday, v._sweek = l._sweek, v._sorder = l._sorder, v.end_date = this.date.add(m, v._length, "day"), v._first_chunk = u.first_chunk, u.first_chunk && (u.first_chunk = !1), o.push(v), g[c] = v, n = v.end_date, d[l._sweek] = g.length - 1, _--;
              }
            }
          }
        }
        return o;
      }, e._copy_dummy = function() {
        var a = new Date(this.start_date), t = new Date(this.end_date);
        this.start_date = a, this.end_date = t;
      }, e._copy_event = function(a) {
        return this._copy_dummy.prototype = a, new this._copy_dummy();
      }, e._rendered = [], e.clear_view = function() {
        for (var a = 0; a < this._rendered.length; a++) {
          var t = this._rendered[a];
          t.parentNode && t.parentNode.removeChild(t);
        }
        this._rendered = [];
      }, e.updateEvent = function(a) {
        var t = this.getEvent(a);
        this.clear_event(a), t && this.is_visible_events(t) && this.filter_event(a, t) && (this._table_view || this.config.multi_day || t._timed) && (this.config.update_render ? this.render_view_data() : this.getState().mode != "month" || this.getState().drag_id || this.isOneDayEvent(t) ? this.render_view_data([t], !0) : this.render_view_data());
      }, e.clear_event = function(a) {
        this.for_rendered(a, function(t, n) {
          t.parentNode && t.parentNode.removeChild(t), e._rendered.splice(n, 1);
        });
      }, e._y_from_date = function(a) {
        var t = 60 * a.getHours() + a.getMinutes();
        return Math.round((60 * t * 1e3 - 60 * this.config.first_hour * 60 * 1e3) * this.config.hour_size_px / 36e5) % (24 * this.config.hour_size_px);
      }, e._calc_event_y = function(a, t) {
        t = t || 0;
        var n = 60 * a.start_date.getHours() + a.start_date.getMinutes(), o = 60 * a.end_date.getHours() + a.end_date.getMinutes() || 60 * e.config.last_hour;
        return { top: this._y_from_date(a.start_date), height: Math.max(t, (o - n) * this.config.hour_size_px / 60) };
      }, e.render_event = function(a, t, n) {
        var o = e.xy.menu_width, r = this.config.use_select_menu_space ? 0 : o;
        if (!(a._sday < 0)) {
          var d = e.locate_holder(a._sday);
          if (d) {
            t = t || d;
            var i = this._calc_event_y(a, e.xy.min_event_height), s = i.top, _ = i.height, l = a._count || 1, h = a._sorder || 0;
            n = n || d.clientWidth, this.config.day_column_padding && (n -= this.config.day_column_padding);
            var u = Math.floor((n - r) / l), m = h * u + (h > 0 ? 2 : 1);
            if (a._inner || (u *= l - h), this.config.cascade_event_display) {
              var f = this.config.cascade_event_count, y = this.config.cascade_event_margin;
              m = h % f * y;
              var b = a._inner ? (l - h - 1) % f * y / 2 : 0;
              u = Math.floor(n - r - m - b);
            }
            a._mode = _ < 30 ? "smallest" : _ < 42 ? "small" : null;
            var c = this._render_v_bar(a, r + m, s, u, _, a._text_style, e.templates.event_header(a.start_date, a.end_date, a), e.templates.event_text(a.start_date, a.end_date, a));
            if (a._mode === "smallest" ? c.classList.add("dhx_cal_event--xsmall") : a._mode === "small" && c.classList.add("dhx_cal_event--small"), this._waiAria.eventAttr(a, c), this._rendered.push(c), t.appendChild(c), m = m + parseInt(this.config.rtl ? d.style.right : d.style.left, 10) + r, this._edit_id == a.id) {
              c.style.zIndex = 1, u = Math.max(u, e.xy.editor_width), (c = document.createElement("div")).setAttribute("event_id", a.id), c.setAttribute(this.config.event_attribute, a.id), this._waiAria.eventAttr(a, c), c.className = "dhx_cal_event dhx_cal_editor", this.config.rtl && m++, this.set_xy(c, u, _, m, s), a.color && c.style.setProperty("--dhx-scheduler-event-background", a.color);
              var g = e.templates.event_class(a.start_date, a.end_date, a);
              g && (c.className += " " + g);
              var v = document.createElement("div");
              v.style.cssText += "overflow:hidden;height:100%", c.appendChild(v), this._els.dhx_cal_data[0].appendChild(c), this._rendered.push(c), v.innerHTML = "<textarea class='dhx_cal_editor'>" + a.text + "</textarea>", this._editor = v.querySelector("textarea"), e.event(this._editor, "keydown", function(D) {
                if (D.shiftKey)
                  return !0;
                var S = D.keyCode;
                S == e.keys.edit_save && e.editStop(!0), S == e.keys.edit_cancel && e.editStop(!1), S != e.keys.edit_save && S != e.keys.edit_cancel || D.preventDefault && D.preventDefault();
              }), e.event(this._editor, "selectstart", function(D) {
                return D.cancelBubble = !0, !0;
              }), e._focus(this._editor, !0), this._els.dhx_cal_data[0].scrollLeft = 0;
            }
            if (this.xy.menu_width !== 0 && this._select_id == a.id) {
              this.config.cascade_event_display && this._drag_mode && (c.style.zIndex = 1);
              for (var p, x = this.config["icons_" + (this._edit_id == a.id ? "edit" : "select")], w = "", k = 0; k < x.length; k++) {
                const D = x[k];
                p = this._waiAria.eventMenuAttrString(D), w += `<div class='dhx_menu_icon ${D}' title='${this.locale.labels[D]}' ${p}></div>`;
              }
              var E = this._render_v_bar(a, m - o - 1, s, o, null, "", "<div class='dhx_menu_head'></div>", w, !0);
              a.color && E.style.setProperty("--dhx-scheduler-event-background", a.color), a.textColor && E.style.setProperty("--dhx-scheduler-event-color", a.textColor), this._els.dhx_cal_data[0].appendChild(E), this._rendered.push(E);
            }
            this.config.drag_highlight && this._drag_id == a.id && this.highlightEventPosition(a);
          }
        }
      }, e._render_v_bar = function(a, t, n, o, r, d, i, s, _) {
        var l = document.createElement("div"), h = a.id, u = _ ? "dhx_cal_event dhx_cal_select_menu" : "dhx_cal_event", m = e.getState();
        m.drag_id == a.id && (u += " dhx_cal_event_drag"), m.select_id == a.id && (u += " dhx_cal_event_selected");
        var f = e.templates.event_class(a.start_date, a.end_date, a);
        f && (u = u + " " + f), this.config.cascade_event_display && (u += " dhx_cal_event_cascade");
        var y = o, b = '<div event_id="' + h + '" ' + this.config.event_attribute + '="' + h + '" class="' + u + '" style="position:absolute; top:' + n + "px; " + (this.config.rtl ? "right:" : "left:") + t + "px; width:" + y + "px; height:" + r + "px;" + (d || "") + '"></div>';
        l.innerHTML = b;
        var c = l.cloneNode(!0).firstChild;
        if (!_ && e.renderEvent(c, a, o, r, i, s))
          return a.color && c.style.setProperty("--dhx-scheduler-event-background", a.color), a.textColor && c.style.setProperty("--dhx-scheduler-event-color", a.textColor), c;
        c = l.firstChild, a.color && c.style.setProperty("--dhx-scheduler-event-background", a.color), a.textColor && c.style.setProperty("--dhx-scheduler-event-color", a.textColor);
        var g = '<div class="dhx_event_move dhx_header" >&nbsp;</div>';
        g += '<div class="dhx_event_move dhx_title">' + i + "</div>", g += '<div class="dhx_body">' + s + "</div>";
        var v = "dhx_event_resize dhx_footer";
        return (_ || a._drag_resize === !1) && (v = "dhx_resize_denied " + v), g += '<div class="' + v + '" style=" width:' + (_ ? " margin-top:-1px;" : "") + '" ></div>', c.innerHTML = g, c;
      }, e.renderEvent = function() {
        return !1;
      }, e.locate_holder = function(a) {
        return this._mode == "day" ? this._els.dhx_cal_data[0].firstChild : this._els.dhx_cal_data[0].childNodes[a];
      }, e.locate_holder_day = function(a, t) {
        var n = Math.floor((this._correct_shift(a, 1) - this._min_date) / 864e5);
        return t && this.date.time_part(a) && n++, n;
      }, e._get_dnd_order = function(a, t, n) {
        if (!this._drag_event)
          return a;
        this._drag_event._orig_sorder ? a = this._drag_event._orig_sorder : this._drag_event._orig_sorder = a;
        for (var o = t * a; o + t > n; )
          a--, o -= t;
        return a = Math.max(a, 0);
      }, e._get_event_bar_pos = function(a) {
        var t = this.config.rtl, n = this._colsS, o = n[a._sday], r = n[a._eday];
        t && (o = n[n.col_length] - n[a._eday] + n[0], r = n[n.col_length] - n[a._sday] + n[0]), r == o && (r = n[a._eday + 1]);
        var d = this.xy.bar_height, i = a._sorder;
        if (a.id == this._drag_id) {
          var s = n.heights[a._sweek + 1] - n.heights[a._sweek] - this.xy.month_head_height;
          i = e._get_dnd_order(i, d, s);
        }
        var _ = i * d;
        return { x: o, x2: r, y: n.heights[a._sweek] + (n.height ? this.xy.month_scale_height + 2 : 2) + _ };
      }, e.render_event_bar = function(a) {
        var t = this._rendered_location, n = this._get_event_bar_pos(a), o = n.y, r = n.x, d = n.x2, i = "";
        if (d) {
          var s = e.config.resize_month_events && this._mode == "month" && (!a._timed || e.config.resize_month_timed), _ = document.createElement("div"), l = a.hasOwnProperty("_first_chunk") && a._first_chunk, h = a.hasOwnProperty("_last_chunk") && a._last_chunk, u = s && (a._timed || l), m = s && (a._timed || h), f = !0, y = "dhx_cal_event_clear";
          a._timed && !s || (f = !1, y = "dhx_cal_event_line"), l && (y += " dhx_cal_event_line_start"), h && (y += " dhx_cal_event_line_end"), u && (i += "<div class='dhx_event_resize dhx_event_resize_start'></div>"), m && (i += "<div class='dhx_event_resize dhx_event_resize_end'></div>");
          var b = e.templates.event_class(a.start_date, a.end_date, a);
          b && (y += " " + b);
          var c = a.color ? "--dhx-scheduler-event-background:" + a.color + ";" : "", g = a.textColor ? "--dhx-scheduler-event-color:" + a.textColor + ";" : "", v = ["position:absolute", "top:" + o + "px", "left:" + r + "px", "width:" + (d - r - (f ? 1 : 0)) + "px", "height:" + (this.xy.bar_height - 2) + "px", g, c, a._text_style || ""].join(";"), p = "<div event_id='" + a.id + "' " + this.config.event_attribute + "='" + a.id + "' class='" + y + "' style='" + v + "'" + this._waiAria.eventBarAttrString(a) + ">";
          s && (p += i), e.getState().mode == "month" && (a = e.getEvent(a.id)), a._timed && (p += `<span class='dhx_cal_event_clear_date'>${e.templates.event_bar_date(a.start_date, a.end_date, a)}</span>`), p += "<div class='dhx_cal_event_line_content'>", p += e.templates.event_bar_text(a.start_date, a.end_date, a) + "</div>", p += "</div>", p += "</div>", _.innerHTML = p, this._rendered.push(_.firstChild), t.appendChild(_.firstChild);
        }
      }, e._locate_event = function(a) {
        for (var t = null; a && !t && a.getAttribute; )
          t = a.getAttribute(this.config.event_attribute), a = a.parentNode;
        return t;
      }, e.edit = function(a) {
        this._edit_id != a && (this.editStop(!1, a), this._edit_id = a, this.updateEvent(a));
      }, e.editStop = function(a, t) {
        if (!t || this._edit_id != t) {
          var n = this.getEvent(this._edit_id);
          n && (a && (n.text = this._editor.value), this._edit_id = null, this._editor = null, this.updateEvent(n.id), this._edit_stop_event(n, a));
        }
      }, e._edit_stop_event = function(a, t) {
        this._new_event ? (t ? this.callEvent("onEventAdded", [a.id, a]) : a && this.deleteEvent(a.id, !0), this._new_event = null) : t && this.callEvent("onEventChanged", [a.id, a]);
      }, e.getEvents = function(a, t) {
        var n = [];
        for (var o in this._events) {
          var r = this._events[o];
          r && (!a && !t || r.start_date < t && r.end_date > a) && n.push(r);
        }
        return n;
      }, e.getRenderedEvent = function(a) {
        if (a) {
          for (var t = e._rendered, n = 0; n < t.length; n++) {
            var o = t[n];
            if (o.getAttribute(e.config.event_attribute) == a)
              return o;
          }
          return null;
        }
      }, e.showEvent = function(a, t) {
        a && typeof a == "object" && (t = a.mode, h = a.section, a = a.section);
        var n = typeof a == "number" || typeof a == "string" ? e.getEvent(a) : a;
        if (t = t || e._mode, n && (!this.checkEvent("onBeforeEventDisplay") || this.callEvent("onBeforeEventDisplay", [n, t]))) {
          var o = e.config.scroll_hour;
          e.config.scroll_hour = n.start_date.getHours();
          var r = e.config.preserve_scroll;
          e.config.preserve_scroll = !1;
          var d = n.color, i = n.textColor;
          if (e.config.highlight_displayed_event && (n.color = e.config.displayed_event_color, n.textColor = e.config.displayed_event_text_color), e.setCurrentView(new Date(n.start_date), t), e.config.scroll_hour = o, e.config.preserve_scroll = r, e.matrix && e.matrix[t]) {
            var s = e.getView(), _ = s.y_property, l = e.getEvent(n.id);
            if (l) {
              if (!h) {
                var h = l[_];
                Array.isArray(h) ? h = h[0] : typeof h == "string" && e.config.section_delimiter && h.indexOf(e.config.section_delimiter) > -1 && (h = h.split(e.config.section_delimiter)[0]);
              }
              var u = s.getSectionTop(h), m = s.posFromDate(l.start_date), f = e.$container.querySelector(".dhx_timeline_data_wrapper");
              if (m -= (f.offsetWidth - s.dx) / 2, u = u - f.offsetHeight / 2 + s.dy / 2, s._smartRenderingEnabled())
                var y = s.attachEvent("onScroll", function() {
                  b(), s.detachEvent(y);
                });
              s.scrollTo({ left: m, top: u }), s._smartRenderingEnabled() || b();
            }
          } else
            b();
          e.callEvent("onAfterEventDisplay", [n, t]);
        }
        function b() {
          n.color = d, n.textColor = i;
        }
      };
    }
    function extend$d(e) {
      e._append_drag_marker = function(a) {
        if (!a.parentNode) {
          var t = e._els.dhx_cal_data[0].lastChild, n = e._getClassName(t);
          n.indexOf("dhx_scale_holder") < 0 && t.previousSibling && (t = t.previousSibling), n = e._getClassName(t), t && n.indexOf("dhx_scale_holder") === 0 && t.appendChild(a);
        }
      }, e._update_marker_position = function(a, t) {
        var n = e._calc_event_y(t, 0);
        a.style.top = n.top + "px", a.style.height = n.height + "px";
      }, e.highlightEventPosition = function(a) {
        var t = document.createElement("div");
        t.setAttribute("event_id", a.id), t.setAttribute(this.config.event_attribute, a.id), this._rendered.push(t), this._update_marker_position(t, a);
        var n = this.templates.drag_marker_class(a.start_date, a.end_date, a), o = this.templates.drag_marker_content(a.start_date, a.end_date, a);
        t.className = "dhx_drag_marker", n && (t.className += " " + n), o && (t.innerHTML = o), this._append_drag_marker(t);
      };
    }
    function extend$c(e) {
      e._parsers.xml = { canParse: function(a, t) {
        if (t.responseXML && t.responseXML.firstChild)
          return !0;
        try {
          var n = e.ajax.parse(t.responseText), o = e.ajax.xmltop("data", n);
          if (o && o.tagName === "data")
            return !0;
        } catch {
        }
        return !1;
      }, parse: function(a) {
        var t;
        if (a.xmlDoc.responseXML || (a.xmlDoc.responseXML = e.ajax.parse(a.xmlDoc.responseText)), (t = e.ajax.xmltop("data", a.xmlDoc)).tagName != "data")
          return null;
        var n = t.getAttribute("dhx_security");
        n && (window.dhtmlx && (window.dhtmlx.security_key = n), e.security_key = n);
        for (var o = e.ajax.xpath("//coll_options", a.xmlDoc), r = 0; r < o.length; r++) {
          var d = o[r].getAttribute("for"), i = e.serverList[d];
          i || (e.serverList[d] = i = []), i.splice(0, i.length);
          for (var s = e.ajax.xpath(".//item", o[r]), _ = 0; _ < s.length; _++) {
            for (var l = s[_].attributes, h = { key: s[_].getAttribute("value"), label: s[_].getAttribute("label") }, u = 0; u < l.length; u++) {
              var m = l[u];
              m.nodeName != "value" && m.nodeName != "label" && (h[m.nodeName] = m.nodeValue);
            }
            i.push(h);
          }
        }
        o.length && e.callEvent("onOptionsLoad", []);
        var f = e.ajax.xpath("//userdata", a.xmlDoc);
        for (r = 0; r < f.length; r++) {
          var y = e._xmlNodeToJSON(f[r]);
          e._userdata[y.name] = y.text;
        }
        var b = [];
        for (t = e.ajax.xpath("//event", a.xmlDoc), r = 0; r < t.length; r++) {
          var c = b[r] = e._xmlNodeToJSON(t[r]);
          e._init_event(c);
        }
        return b;
      } };
    }
    function extend$b(e) {
      e.json = e._parsers.json = { canParse: function(a) {
        if (a && typeof a == "object")
          return !0;
        if (typeof a == "string")
          try {
            var t = JSON.parse(a);
            return Object.prototype.toString.call(t) === "[object Object]" || Object.prototype.toString.call(t) === "[object Array]";
          } catch {
            return !1;
          }
        return !1;
      }, parse: function(a) {
        var t = [];
        typeof a == "string" && (a = JSON.parse(a)), Object.prototype.toString.call(a) === "[object Array]" ? t = a : a && (a.events ? t = a.events : a.data && (t = a.data)), t = t || [], a.dhx_security && (window.dhtmlx && (window.dhtmlx.security_key = a.dhx_security), e.security_key = a.dhx_security);
        var n = a && a.collections ? a.collections : {}, o = !1;
        for (var r in n)
          if (n.hasOwnProperty(r)) {
            o = !0;
            var d = n[r], i = e.serverList[r];
            i || (e.serverList[r] = i = []), i.splice(0, i.length);
            for (var s = 0; s < d.length; s++) {
              var _ = d[s], l = { key: _.value, label: _.label };
              for (var h in _)
                if (_.hasOwnProperty(h)) {
                  if (h == "value" || h == "label")
                    continue;
                  l[h] = _[h];
                }
              i.push(l);
            }
          }
        o && e.callEvent("onOptionsLoad", []);
        for (var u = [], m = 0; m < t.length; m++) {
          var f = t[m];
          e._init_event(f), u.push(f);
        }
        return u;
      } };
    }
    function extend$a(e) {
      e.ical = e._parsers.ical = { canParse: function(a) {
        return typeof a == "string" && new RegExp("^BEGIN:VCALENDAR").test(a);
      }, parse: function(a) {
        var t = a.match(RegExp(this.c_start + "[^\f]*" + this.c_end, ""));
        if (t.length) {
          t[0] = t[0].replace(/[\r\n]+ /g, ""), t[0] = t[0].replace(/[\r\n]+(?=[a-z \t])/g, " "), t[0] = t[0].replace(/;[^:\r\n]*:/g, ":");
          for (var n, o = [], r = RegExp("(?:" + this.e_start + ")([^\f]*?)(?:" + this.e_end + ")", "g"); (n = r.exec(t)) !== null; ) {
            for (var d, i = {}, s = /[^\r\n]+[\r\n]+/g; (d = s.exec(n[1])) !== null; )
              this.parse_param(d.toString(), i);
            i.uid && !i.id && (i.id = i.uid), o.push(i);
          }
          return o;
        }
      }, parse_param: function(a, t) {
        var n = a.indexOf(":");
        if (n != -1) {
          var o = a.substr(0, n).toLowerCase(), r = a.substr(n + 1).replace(/\\,/g, ",").replace(/[\r\n]+$/, "");
          o == "summary" ? o = "text" : o == "dtstart" ? (o = "start_date", r = this.parse_date(r, 0, 0)) : o == "dtend" && (o = "end_date", r = this.parse_date(r, 0, 0)), t[o] = r;
        }
      }, parse_date: function(a, t, n) {
        var o = a.split("T"), r = !1;
        o[1] && (t = o[1].substr(0, 2), n = o[1].substr(2, 2), r = o[1][6] == "Z");
        var d = o[0].substr(0, 4), i = parseInt(o[0].substr(4, 2), 10) - 1, s = o[0].substr(6, 2);
        return e.config.server_utc || r ? new Date(Date.UTC(d, i, s, t, n)) : new Date(d, i, s, t, n);
      }, c_start: "BEGIN:VCALENDAR", e_start: "BEGIN:VEVENT", e_end: "END:VEVENT", c_end: "END:VCALENDAR" };
    }
    function getSerializator(e) {
      return (function() {
        var a = {};
        for (var t in this._events) {
          var n = this._events[t];
          n.id.toString().indexOf("#") == -1 && (a[n.id] = n);
        }
        return a;
      }).bind(e);
    }
    function extend$9(e) {
      e._loaded = {}, e._load = function(t, n) {
        if (t = t || this._load_url) {
          var o;
          if (t += (t.indexOf("?") == -1 ? "?" : "&") + "timeshift=" + (/* @__PURE__ */ new Date()).getTimezoneOffset(), this.config.prevent_cache && (t += "&uid=" + this.uid()), n = n || this._date, this._load_mode) {
            var r = this.templates.load_format;
            for (n = this.date[this._load_mode + "_start"](new Date(n.valueOf())); n > this._min_date; )
              n = this.date.add(n, -1, this._load_mode);
            o = n;
            for (var d = !0; o < this._max_date; )
              o = this.date.add(o, 1, this._load_mode), this._loaded[r(n)] && d ? n = this.date.add(n, 1, this._load_mode) : d = !1;
            var i = o;
            do
              o = i, i = this.date.add(o, -1, this._load_mode);
            while (i > n && this._loaded[r(i)]);
            if (o <= n)
              return !1;
            for (e.ajax.get(t + "&from=" + r(n) + "&to=" + r(o), s); n < o; )
              this._loaded[r(n)] = !0, n = this.date.add(n, 1, this._load_mode);
          } else
            e.ajax.get(t, s);
          return this.callEvent("onXLS", []), this.callEvent("onLoadStart", []), !0;
        }
        function s(_) {
          e.on_load(_), e.callEvent("onLoadEnd", []);
        }
      }, e._parsers = {}, extend$c(e), extend$b(e), extend$a(e), e.on_load = function(t) {
        var n;
        this.callEvent("onBeforeParse", []);
        var o = !1, r = !1;
        for (var d in this._parsers) {
          var i = this._parsers[d];
          if (i.canParse(t.xmlDoc.responseText, t.xmlDoc)) {
            try {
              var s = t.xmlDoc.responseText;
              d === "xml" && (s = t), (n = i.parse(s)) || (o = !0);
            } catch {
              o = !0;
            }
            r = !0;
            break;
          }
        }
        if (!r)
          if (this._process && this[this._process])
            try {
              n = this[this._process].parse(t.xmlDoc.responseText);
            } catch {
              o = !0;
            }
          else
            o = !0;
        (o || t.xmlDoc.status && t.xmlDoc.status >= 400) && (this.callEvent("onLoadError", [t.xmlDoc]), n = []), this._process_loading(n), this.callEvent("onXLE", []), this.callEvent("onParse", []);
      }, e._process_loading = function(t) {
        this._loading = !0, this._not_render = !0;
        for (var n = 0; n < t.length; n++)
          this.callEvent("onEventLoading", [t[n]]) && this.addEvent(t[n]);
        this._not_render = !1, this._render_wait && this.render_view_data(), this._loading = !1, this._after_call && this._after_call(), this._after_call = null;
      }, e._init_event = function(t) {
        t.text = t.text || t._tagvalue || "", t.start_date = e._init_date(t.start_date), t.end_date = e._init_date(t.end_date);
      }, e._init_date = function(t) {
        return t ? typeof t == "string" ? e._helpers.parseDate(t) : new Date(t) : null;
      };
      const a = getSerializator(e);
      e.serialize = function() {
        const t = [], n = a();
        for (var o in n) {
          const i = {};
          var r = n[o];
          for (var d in r) {
            if (d.charAt(0) == "$" || d.charAt(0) == "_")
              continue;
            let s;
            const _ = r[d];
            s = e.utils.isDate(_) ? e.defined(e.templates.xml_format) ? e.templates.xml_format(_) : e.templates.format_date(_) : _, i[d] = s;
          }
          t.push(i);
        }
        return t;
      }, e.parse = function(t, n) {
        this._process = n, this.on_load({ xmlDoc: { responseText: t } });
      }, e.load = function(t, n) {
        typeof n == "string" && (this._process = n, n = arguments[2]), this._load_url = t, this._after_call = n, this._load(t, this._date);
      }, e.setLoadMode = function(t) {
        t == "all" && (t = ""), this._load_mode = t;
      }, e.serverList = function(t, n) {
        return n ? (this.serverList[t] = n.slice(0), this.serverList[t]) : (this.serverList[t] = this.serverList[t] || [], this.serverList[t]);
      }, e._userdata = {}, e._xmlNodeToJSON = function(t) {
        for (var n = {}, o = 0; o < t.attributes.length; o++)
          n[t.attributes[o].name] = t.attributes[o].value;
        for (o = 0; o < t.childNodes.length; o++) {
          var r = t.childNodes[o];
          r.nodeType == 1 && (n[r.tagName] = r.firstChild ? r.firstChild.nodeValue : "");
        }
        return n.text || (n.text = t.firstChild ? t.firstChild.nodeValue : ""), n;
      }, e.attachEvent("onXLS", function() {
        var t;
        this.config.show_loading === !0 && ((t = this.config.show_loading = document.createElement("div")).className = "dhx_loading", t.style.left = Math.round((this._x - 128) / 2) + "px", t.style.top = Math.round((this._y - 15) / 2) + "px", this._obj.appendChild(t));
      }), e.attachEvent("onXLE", function() {
        var t = this.config.show_loading;
        t && typeof t == "object" && (t.parentNode && t.parentNode.removeChild(t), this.config.show_loading = !0);
      });
    }
    function extend$8(e) {
      function a() {
        const t = e.config.csp === !0, n = !!window.Sfdc || !!window.$A || window.Aura || "$shadowResolver$" in document.body;
        return t || n ? e.$root : document.body;
      }
      e._lightbox_controls = {}, e.formSection = function(t) {
        for (var n = this.config.lightbox.sections, o = 0; o < n.length && n[o].name != t; o++)
          ;
        if (o === n.length)
          return null;
        var r = n[o];
        e._lightbox || e.getLightbox();
        var d = e._lightbox.querySelector(`#${r.id}`), i = d.nextSibling, s = { section: r, header: d, node: i, getValue: function(l) {
          return e.form_blocks[r.type].get_value(i, l || {}, r);
        }, setValue: function(l, h) {
          return e.form_blocks[r.type].set_value(i, l, h || {}, r);
        } }, _ = e._lightbox_controls["get_" + r.type + "_control"];
        return _ ? _(s) : s;
      }, e._lightbox_controls.get_template_control = function(t) {
        return t.control = t.node, t;
      }, e._lightbox_controls.get_select_control = function(t) {
        return t.control = t.node.getElementsByTagName("select")[0], t;
      }, e._lightbox_controls.get_textarea_control = function(t) {
        return t.control = t.node.getElementsByTagName("textarea")[0], t;
      }, e._lightbox_controls.get_time_control = function(t) {
        return t.control = t.node.getElementsByTagName("select"), t;
      }, e._lightbox_controls.defaults = { template: { height: 30 }, textarea: { height: 200 }, select: { height: 23 }, time: { height: 20 } }, e.form_blocks = { template: { render: function(t) {
        return "<div class='dhx_cal_ltext dhx_cal_template' ></div>";
      }, set_value: function(t, n, o, r) {
        t.innerHTML = n || "";
      }, get_value: function(t, n, o) {
        return t.innerHTML || "";
      }, focus: function(t) {
      } }, textarea: { render: function(t) {
        return "<div class='dhx_cal_ltext'><textarea></textarea></div>";
      }, set_value: function(t, n, o) {
        e.form_blocks.textarea._get_input(t).value = n || "";
      }, get_value: function(t, n) {
        return e.form_blocks.textarea._get_input(t).value;
      }, focus: function(t) {
        var n = e.form_blocks.textarea._get_input(t);
        e._focus(n, !0);
      }, _get_input: function(t) {
        return t.getElementsByTagName("textarea")[0];
      } }, select: { render: function(t) {
        for (var n = "<div class='dhx_cal_ltext dhx_cal_select'><select style='width:100%;'>", o = 0; o < t.options.length; o++)
          n += "<option value='" + t.options[o].key + "'>" + t.options[o].label + "</option>";
        return n += "</select></div>";
      }, set_value: function(t, n, o, r) {
        var d = t.firstChild;
        !d._dhx_onchange && r.onchange && (e.event(d, "change", r.onchange), d._dhx_onchange = !0), n === void 0 && (n = (d.options[0] || {}).value), d.value = n || "";
      }, get_value: function(t, n) {
        return t.firstChild.value;
      }, focus: function(t) {
        var n = t.firstChild;
        e._focus(n, !0);
      } }, time: { render: function(t) {
        t.time_format || (t.time_format = ["%H:%i", "%d", "%m", "%Y"]), t._time_format_order = {};
        var n = t.time_format, o = e.config, r = e.date.date_part(e._currentDate()), d = 1440, i = 0;
        e.config.limit_time_select && (d = 60 * o.last_hour + 1, i = 60 * o.first_hour, r.setHours(o.first_hour));
        for (var s = "", _ = 0; _ < n.length; _++) {
          var l = n[_];
          _ > 0 && (s += " ");
          var h = "", u = "";
          switch (l) {
            case "%Y":
              var m, f, y;
              h = "dhx_lightbox_year_select", t._time_format_order[3] = _, t.year_range && (isNaN(t.year_range) ? t.year_range.push && (f = t.year_range[0], y = t.year_range[1]) : m = t.year_range), m = m || 10;
              var b = b || Math.floor(m / 2);
              f = f || r.getFullYear() - b, y = y || f + m;
              for (var c = f; c < y; c++)
                u += "<option value='" + c + "'>" + c + "</option>";
              break;
            case "%m":
              for (h = "dhx_lightbox_month_select", t._time_format_order[2] = _, c = 0; c < 12; c++)
                u += "<option value='" + c + "'>" + this.locale.date.month_full[c] + "</option>";
              break;
            case "%d":
              for (h = "dhx_lightbox_day_select", t._time_format_order[1] = _, c = 1; c < 32; c++)
                u += "<option value='" + c + "'>" + c + "</option>";
              break;
            case "%H:%i":
              h = "dhx_lightbox_time_select", t._time_format_order[0] = _, c = i;
              var g = r.getDate();
              for (t._time_values = []; c < d; )
                u += "<option value='" + c + "'>" + this.templates.time_picker(r) + "</option>", t._time_values.push(c), r.setTime(r.valueOf() + 60 * this.config.time_step * 1e3), c = 24 * (r.getDate() != g ? 1 : 0) * 60 + 60 * r.getHours() + r.getMinutes();
          }
          if (u) {
            var v = e._waiAria.lightboxSelectAttrString(l);
            s += "<select class='" + h + "' " + (t.readonly ? "disabled='disabled'" : "") + v + ">" + u + "</select> ";
          }
        }
        return "<div class='dhx_section_time'>" + s + "<span style='font-weight:normal; font-size:10pt;' class='dhx_section_time_spacer'> &nbsp;&ndash;&nbsp; </span>" + s + "</div>";
      }, set_value: function(t, n, o, r) {
        var d, i, s = e.config, _ = t.getElementsByTagName("select"), l = r._time_format_order;
        if (s.full_day) {
          if (!t._full_day) {
            var h = "<label class='dhx_fullday'><input type='checkbox' name='full_day' value='true'> " + e.locale.labels.full_day + "&nbsp;</label></input>";
            e.config.wide_form || (h = t.previousSibling.innerHTML + h), t.previousSibling.innerHTML = h, t._full_day = !0;
          }
          var u = t.previousSibling.getElementsByTagName("input")[0];
          u.checked = e.date.time_part(o.start_date) === 0 && e.date.time_part(o.end_date) === 0, _[l[0]].disabled = u.checked, _[l[0] + _.length / 2].disabled = u.checked, u.$_eventAttached || (u.$_eventAttached = !0, e.event(u, "click", function() {
            if (u.checked) {
              var b = {};
              e.form_blocks.time.get_value(t, b, r), d = e.date.date_part(b.start_date), (+(i = e.date.date_part(b.end_date)) == +d || +i >= +d && (o.end_date.getHours() !== 0 || o.end_date.getMinutes() !== 0)) && (i = e.date.add(i, 1, "day"));
            } else
              d = null, i = null;
            _[l[0]].disabled = u.checked, _[l[0] + _.length / 2].disabled = u.checked, y(_, 0, d || o.start_date), y(_, 4, i || o.end_date);
          }));
        }
        if (s.auto_end_date && s.event_duration)
          for (var m = function() {
            s.auto_end_date && s.event_duration && (d = new Date(_[l[3]].value, _[l[2]].value, _[l[1]].value, 0, _[l[0]].value), i = new Date(d.getTime() + 60 * e.config.event_duration * 1e3), y(_, 4, i));
          }, f = 0; f < 4; f++)
            _[f].$_eventAttached || (_[f].$_eventAttached = !0, e.event(_[f], "change", m));
        function y(b, c, g) {
          for (var v = r._time_values, p = 60 * g.getHours() + g.getMinutes(), x = p, w = !1, k = 0; k < v.length; k++) {
            var E = v[k];
            if (E === p) {
              w = !0;
              break;
            }
            E < p && (x = E);
          }
          b[c + l[0]].value = w ? p : x, w || x || (b[c + l[0]].selectedIndex = -1), b[c + l[1]].value = g.getDate(), b[c + l[2]].value = g.getMonth(), b[c + l[3]].value = g.getFullYear();
        }
        y(_, 0, o.start_date), y(_, 4, o.end_date);
      }, get_value: function(t, n, o) {
        var r = t.getElementsByTagName("select"), d = o._time_format_order;
        if (n.start_date = new Date(r[d[3]].value, r[d[2]].value, r[d[1]].value, 0, r[d[0]].value), n.end_date = new Date(r[d[3] + 4].value, r[d[2] + 4].value, r[d[1] + 4].value, 0, r[d[0] + 4].value), !r[d[3]].value || !r[d[3] + 4].value) {
          var i = e.getEvent(e._lightbox_id);
          i && (n.start_date = i.start_date, n.end_date = i.end_date);
        }
        return n.end_date <= n.start_date && (n.end_date = e.date.add(n.start_date, e.config.time_step, "minute")), { start_date: new Date(n.start_date), end_date: new Date(n.end_date) };
      }, focus: function(t) {
        e._focus(t.getElementsByTagName("select")[0]);
      } } }, e._setLbPosition = function(t) {
        t && (t.style.top = Math.max(a().offsetHeight / 2 - t.offsetHeight / 2, 0) + "px", t.style.left = Math.max(a().offsetWidth / 2 - t.offsetWidth / 2, 0) + "px");
      }, e.showCover = function(t) {
        t && (t.style.display = "block", this._setLbPosition(t)), e.config.responsive_lightbox && (document.documentElement.classList.add("dhx_cal_overflow_container"), a().classList.add("dhx_cal_overflow_container")), this.show_cover(), this._cover.style.display = "";
      }, e.showLightbox = function(t) {
        if (t)
          if (this.callEvent("onBeforeLightbox", [t])) {
            this.showCover(n);
            var n = this.getLightbox();
            this._setLbPosition(n), this._fill_lightbox(t, n), this._waiAria.lightboxVisibleAttr(n), this.callEvent("onLightbox", [t]);
          } else
            this._new_event && (this._new_event = null);
      }, e._fill_lightbox = function(t, n) {
        var o = this.getEvent(t), r = n.getElementsByTagName("span"), d = [];
        if (e.templates.lightbox_header) {
          d.push("");
          var i = e.templates.lightbox_header(o.start_date, o.end_date, o);
          d.push(i), r[1].innerHTML = "", r[2].innerHTML = i;
        } else {
          var s = this.templates.event_header(o.start_date, o.end_date, o), _ = (this.templates.event_bar_text(o.start_date, o.end_date, o) || "").substr(0, 70);
          d.push(s), d.push(_), r[1].innerHTML = s, r[2].innerHTML = _;
        }
        this._waiAria.lightboxHeader(n, d.join(" "));
        for (var l = this.config.lightbox.sections, h = 0; h < l.length; h++) {
          var u = l[h], m = e._get_lightbox_section_node(u), f = this.form_blocks[u.type], y = o[u.map_to] !== void 0 ? o[u.map_to] : u.default_value;
          f.set_value.call(this, m, y, o, u), l[h].focus && f.focus.call(this, m);
        }
        e._lightbox_id = t;
      }, e._get_lightbox_section_node = function(t) {
        return e._lightbox.querySelector(`#${t.id}`).nextSibling;
      }, e._lightbox_out = function(t) {
        for (var n = this.config.lightbox.sections, o = 0; o < n.length; o++) {
          var r = e._lightbox.querySelector(`#${n[o].id}`);
          r = r && r.nextSibling;
          var d = this.form_blocks[n[o].type].get_value.call(this, r, t, n[o]);
          n[o].map_to != "auto" && (t[n[o].map_to] = d);
        }
        return t;
      }, e._empty_lightbox = function(t) {
        var n = e._lightbox_id, o = this.getEvent(n);
        this._lame_copy(o, t), this.setEvent(o.id, o), this._edit_stop_event(o, !0), this.render_view_data();
      }, e.hide_lightbox = function(t) {
        e.endLightbox(!1, this.getLightbox());
      }, e.hideCover = function(t) {
        t && (t.style.display = "none"), this.hide_cover(), e.config.responsive_lightbox && (document.documentElement.classList.remove("dhx_cal_overflow_container"), a().classList.remove("dhx_cal_overflow_container"));
      }, e.hide_cover = function() {
        this._cover && this._cover.parentNode.removeChild(this._cover), this._cover = null;
      }, e.show_cover = function() {
        this._cover || (this._cover = document.createElement("div"), this._cover.className = "dhx_cal_cover", this._cover.style.display = "none", e.event(this._cover, "mousemove", e._move_while_dnd), e.event(this._cover, "mouseup", e._finish_dnd), a().appendChild(this._cover));
      }, e.save_lightbox = function() {
        var t = this._lightbox_out({}, this._lame_copy(this.getEvent(this._lightbox_id)));
        this.checkEvent("onEventSave") && !this.callEvent("onEventSave", [this._lightbox_id, t, this._new_event]) || (this._empty_lightbox(t), this.hide_lightbox());
      }, e.startLightbox = function(t, n) {
        this._lightbox_id = t, this._custom_lightbox = !0, this._temp_lightbox = this._lightbox, this._lightbox = n, this.showCover(n);
      }, e.endLightbox = function(t, n) {
        n = n || e.getLightbox();
        var o = e.getEvent(this._lightbox_id);
        o && this._edit_stop_event(o, t), t && e.render_view_data(), this.hideCover(n), this._custom_lightbox && (this._lightbox = this._temp_lightbox, this._custom_lightbox = !1), this._temp_lightbox = this._lightbox_id = null, this._waiAria.lightboxHiddenAttr(n), this.resetLightbox(), this.callEvent("onAfterLightbox", []);
      }, e.resetLightbox = function() {
        e._lightbox && !e._custom_lightbox && e._lightbox.parentNode.removeChild(e._lightbox), e._lightbox = null;
      }, e.cancel_lightbox = function() {
        this._lightbox_id && this.callEvent("onEventCancel", [this._lightbox_id, !!this._new_event]), this.hide_lightbox();
      }, e.hideLightbox = e.cancel_lightbox, e._init_lightbox_events = function() {
        if (this.getLightbox().$_eventAttached)
          return;
        const t = this.getLightbox();
        t.$_eventAttached = !0, e.event(t, "click", function(n) {
          n.target.closest(".dhx_cal_ltitle_close_btn") && e.cancel_lightbox();
          const o = e.$domHelpers.closest(n.target, ".dhx_btn_set");
          if (!o) {
            const i = e.$domHelpers.closest(n.target, ".dhx_custom_button[data-section-index]");
            if (i) {
              const s = Number(i.getAttribute("data-section-index"));
              e.form_blocks[e.config.lightbox.sections[s].type].button_click(e.$domHelpers.closest(i, ".dhx_cal_lsection"), i, n);
            }
            return;
          }
          const r = o ? o.getAttribute("data-action") : null;
          switch (r) {
            case "dhx_save_btn":
            case "save":
              if (e.config.readonly_active)
                return;
              e.save_lightbox();
              break;
            case "dhx_delete_btn":
            case "delete":
              if (e.config.readonly_active)
                return;
              var d = e.locale.labels.confirm_deleting;
              e._dhtmlx_confirm({ message: d, title: e.locale.labels.title_confirm_deleting, callback: function() {
                e.deleteEvent(e._lightbox_id), e._new_event = null, e.hide_lightbox();
              }, config: { ok: e.locale.labels.icon_delete } });
              break;
            case "dhx_cancel_btn":
            case "cancel":
              e.cancel_lightbox();
              break;
            default:
              e.callEvent("onLightboxButton", [r, o, n]);
          }
        }), e.event(t, "keydown", function(n) {
          var o = n || window.event, r = n.target || n.srcElement, d = r.querySelector("[dhx_button]");
          switch (d || (d = r.parentNode.querySelector(".dhx_custom_button, .dhx_readonly")), (n || o).keyCode) {
            case 32:
              if ((n || o).shiftKey)
                return;
              d && d.click && d.click();
              break;
            case e.keys.edit_save:
              if ((n || o).shiftKey)
                return;
              if (d && d.click)
                d.click();
              else {
                if (e.config.readonly_active)
                  return;
                e.save_lightbox();
              }
              break;
            case e.keys.edit_cancel:
              e.cancel_lightbox();
          }
        });
      }, e.setLightboxSize = function() {
      }, e._init_dnd_events = function() {
        e.event(a(), "mousemove", e._move_while_dnd), e.event(a(), "mouseup", e._finish_dnd), e._init_dnd_events = function() {
        };
      }, e._move_while_dnd = function(t) {
        if (e._dnd_start_lb) {
          document.dhx_unselectable || (a().classList.add("dhx_unselectable"), document.dhx_unselectable = !0);
          var n = e.getLightbox(), o = [t.pageX, t.pageY];
          n.style.top = e._lb_start[1] + o[1] - e._dnd_start_lb[1] + "px", n.style.left = e._lb_start[0] + o[0] - e._dnd_start_lb[0] + "px";
        }
      }, e._ready_to_dnd = function(t) {
        var n = e.getLightbox();
        e._lb_start = [n.offsetLeft, n.offsetTop], e._dnd_start_lb = [t.pageX, t.pageY];
      }, e._finish_dnd = function() {
        e._lb_start && (e._lb_start = e._dnd_start_lb = !1, a().classList.remove("dhx_unselectable"), document.dhx_unselectable = !1);
      }, e.getLightbox = function() {
        if (!this._lightbox) {
          var t = document.createElement("div");
          t.className = "dhx_cal_light", e.config.wide_form && (t.className += " dhx_cal_light_wide"), e.form_blocks.recurring && (t.className += " dhx_cal_light_rec"), e.config.rtl && (t.className += " dhx_cal_light_rtl"), e.config.responsive_lightbox && (t.className += " dhx_cal_light_responsive"), t.style.visibility = "hidden";
          var n = this._lightbox_template, o = this.config.buttons_left;
          n += "<div class='dhx_cal_lcontrols'>";
          for (var r = 0; r < o.length; r++)
            n += "<div " + this._waiAria.lightboxButtonAttrString(o[r]) + " data-action='" + o[r] + "' class='dhx_btn_set dhx_" + (e.config.rtl ? "right" : "left") + "_btn_set " + o[r] + "_set'><div class='dhx_btn_inner " + o[r] + "'></div><div>" + e.locale.labels[o[r]] + "</div></div>";
          o = this.config.buttons_right;
          var d = e.config.rtl;
          for (r = 0; r < o.length; r++)
            n += "<div class='dhx_cal_lcontrols_push_right'></div>", n += "<div " + this._waiAria.lightboxButtonAttrString(o[r]) + " data-action='" + o[r] + "' class='dhx_btn_set dhx_" + (d ? "left" : "right") + "_btn_set " + o[r] + "_set'><div class='dhx_btn_inner " + o[r] + "'></div><div>" + e.locale.labels[o[r]] + "</div></div>";
          n += "</div>", n += "</div>", t.innerHTML = n, e.config.drag_lightbox && (e.event(t.firstChild, "mousedown", e._ready_to_dnd), e.event(t.firstChild, "selectstart", function(m) {
            return m.preventDefault(), !1;
          }), t.firstChild.style.cursor = "move", e._init_dnd_events()), this._waiAria.lightboxAttr(t), this.show_cover(), this._cover.insertBefore(t, this._cover.firstChild), this._lightbox = t;
          var i = this.config.lightbox.sections;
          for (n = "", r = 0; r < i.length; r++) {
            var s = this.form_blocks[i[r].type];
            if (s) {
              i[r].id = "area_" + this.uid();
              var _ = "";
              i[r].button && (_ = "<div " + e._waiAria.lightboxSectionButtonAttrString(this.locale.labels["button_" + i[r].button]) + " class='dhx_custom_button' data-section-index='" + r + "' index='" + r + "'><div class='dhx_custom_button_" + i[r].button + "'></div><div>" + this.locale.labels["button_" + i[r].button] + "</div></div>"), this.config.wide_form && (n += "<div class='dhx_wrap_section'>");
              var l = this.locale.labels["section_" + i[r].name];
              typeof l != "string" && (l = i[r].name), n += "<div id='" + i[r].id + "' class='dhx_cal_lsection'>" + _ + "<label>" + l + "</label></div>" + s.render.call(this, i[r]), n += "</div>";
            }
          }
          var h = t.getElementsByTagName("div");
          for (r = 0; r < h.length; r++) {
            var u = h[r];
            if (e._getClassName(u) == "dhx_cal_larea") {
              u.innerHTML = n;
              break;
            }
          }
          e._bindLightboxLabels(i), this.setLightboxSize(), this._init_lightbox_events(this), t.style.visibility = "visible";
        }
        return this._lightbox;
      }, e._bindLightboxLabels = function(t) {
        for (var n = 0; n < t.length; n++) {
          var o = t[n];
          if (o.id && e._lightbox.querySelector(`#${o.id}`)) {
            for (var r = e._lightbox.querySelector(`#${o.id}`).querySelector("label"), d = e._get_lightbox_section_node(o); d && !d.querySelector; )
              d = d.nextSibling;
            var i = !0;
            if (d) {
              var s = d.querySelector("input, select, textarea");
              s && (o.inputId = s.id || "input_" + e.uid(), s.id || (s.id = o.inputId), r.setAttribute("for", o.inputId), i = !1);
            }
            i && e.form_blocks[o.type].focus && e.event(r, "click", function(_) {
              return function() {
                var l = e.form_blocks[_.type], h = e._get_lightbox_section_node(_);
                l && l.focus && l.focus.call(e, h);
              };
            }(o));
          }
        }
      }, e.attachEvent("onEventIdChange", function(t, n) {
        this._lightbox_id == t && (this._lightbox_id = n);
      }), e._lightbox_template = `<div class='dhx_cal_ltitle'><div class="dhx_cal_ltitle_descr"><span class='dhx_mark'>&nbsp;</span><span class='dhx_time'></span><span class='dhx_title'></span>
</div>
<div class="dhx_cal_ltitle_controls">
<a class="dhx_cal_ltitle_close_btn scheduler_icon close"></a>
</div></div><div class='dhx_cal_larea'></div>`;
    }
    function extend$7(e) {
      e._init_touch_events = function() {
        if ((this.config.touch && (navigator.userAgent.indexOf("Mobile") != -1 || navigator.userAgent.indexOf("iPad") != -1 || navigator.userAgent.indexOf("Android") != -1 || navigator.userAgent.indexOf("Touch") != -1) && !window.MSStream || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) && (this.xy.scroll_width = 0, this._mobile = !0), this.config.touch) {
          var a = !0;
          try {
            document.createEvent("TouchEvent");
          } catch {
            a = !1;
          }
          a ? this._touch_events(["touchmove", "touchstart", "touchend"], function(t) {
            return t.touches && t.touches.length > 1 ? null : t.touches[0] ? { target: t.target, pageX: t.touches[0].pageX, pageY: t.touches[0].pageY, clientX: t.touches[0].clientX, clientY: t.touches[0].clientY } : t;
          }, function() {
            return !1;
          }) : window.PointerEvent || window.navigator.pointerEnabled ? this._touch_events(["pointermove", "pointerdown", "pointerup"], function(t) {
            return t.pointerType == "mouse" ? null : t;
          }, function(t) {
            return !t || t.pointerType == "mouse";
          }) : window.navigator.msPointerEnabled && this._touch_events(["MSPointerMove", "MSPointerDown", "MSPointerUp"], function(t) {
            return t.pointerType == t.MSPOINTER_TYPE_MOUSE ? null : t;
          }, function(t) {
            return !t || t.pointerType == t.MSPOINTER_TYPE_MOUSE;
          });
        }
      }, e._touch_events = function(a, t, n) {
        var o, r, d, i, s, _, l = 0;
        function h(m, f, y) {
          e.event(m, f, function(b) {
            return !!e._is_lightbox_open() || (n(b) ? void 0 : y(b));
          }, { passive: !1 });
        }
        function u(m) {
          n(m) || (e._hide_global_tip(), i && (e._on_mouse_up(t(m)), e._temp_touch_block = !1), e._drag_id = null, e._drag_mode = null, e._drag_pos = null, e._pointerDragId = null, clearTimeout(d), i = _ = !1, s = !0);
        }
        h(document.body, a[0], function(m) {
          if (!n(m)) {
            var f = t(m);
            if (f) {
              if (i)
                return function(y) {
                  if (!n(y)) {
                    var b = e.getState().drag_mode, c = !!e.matrix && e.matrix[e._mode], g = e.render_view_data;
                    b == "create" && c && (e.render_view_data = function() {
                      for (var v = e.getState().drag_id, p = e.getEvent(v), x = c.y_property, w = e.getEvents(p.start_date, p.end_date), k = 0; k < w.length; k++)
                        w[k][x] != p[x] && (w.splice(k, 1), k--);
                      p._sorder = w.length - 1, p._count = w.length, this.render_data([p], e.getState().mode);
                    }), e._on_mouse_move(y), b == "create" && c && (e.render_view_data = g), y.preventDefault && y.preventDefault(), y.cancelBubble = !0;
                  }
                }(f), m.preventDefault && m.preventDefault(), m.cancelBubble = !0, e._update_global_tip(), !1;
              r = t(m), _ && (r ? (o.target != r.target || Math.abs(o.pageX - r.pageX) > 5 || Math.abs(o.pageY - r.pageY) > 5) && (s = !0, clearTimeout(d)) : s = !0);
            }
          }
        }), h(this._els.dhx_cal_data[0], "touchcancel", u), h(this._els.dhx_cal_data[0], "contextmenu", function(m) {
          if (!n(m))
            return _ ? (m && m.preventDefault && m.preventDefault(), m.cancelBubble = !0, !1) : void 0;
        }), h(this._obj, a[1], function(m) {
          var f;
          if (document && document.body && document.body.classList.add("dhx_cal_touch_active"), !n(m))
            if (e._pointerDragId = m.pointerId, i = s = !1, _ = !0, f = r = t(m)) {
              var y = /* @__PURE__ */ new Date();
              if (!s && !i && y - l < 250)
                return e._click.dhx_cal_data(f), window.setTimeout(function() {
                  e.$destroyed || e._on_dbl_click(f);
                }, 50), m.preventDefault && m.preventDefault(), m.cancelBubble = !0, e._block_next_stop = !0, !1;
              if (l = y, !s && !i && e.config.touch_drag) {
                var b = e._locate_event(document.activeElement), c = e._locate_event(f.target), g = o ? e._locate_event(o.target) : null;
                if (b && c && b == c && b != g)
                  return m.preventDefault && m.preventDefault(), m.cancelBubble = !0, e._ignore_next_click = !1, e._click.dhx_cal_data(f), o = f, !1;
                d = setTimeout(function() {
                  if (!e.$destroyed) {
                    i = !0;
                    var v = o.target, p = e._getClassName(v);
                    v && p.indexOf("dhx_body") != -1 && (v = v.previousSibling), e._on_mouse_down(o, v), e._drag_mode && e._drag_mode != "create" && e.for_rendered(e._drag_id, function(x, w) {
                      x.style.display = "none", e._rendered.splice(w, 1);
                    }), e.config.touch_tip && e._show_global_tip(), e.updateEvent(e._drag_id);
                  }
                }, e.config.touch_drag), o = f;
              }
            } else
              s = !0;
        }), h(this._els.dhx_cal_data[0], a[2], function(m) {
          if (document && document.body && document.body.classList.remove("dhx_cal_touch_active"), !n(m))
            return e.config.touch_swipe_dates && !i && function(f, y, b, c) {
              if (!f || !y)
                return !1;
              for (var g = f.target; g && g != e._obj; )
                g = g.parentNode;
              if (g != e._obj || e.matrix && e.matrix[e.getState().mode] && e.matrix[e.getState().mode].scrollable)
                return !1;
              var v = Math.abs(f.pageY - y.pageY), p = Math.abs(f.pageX - y.pageX);
              return v < c && p > b && (!v || p / v > 3) && (f.pageX > y.pageX ? e._click.dhx_cal_next_button() : e._click.dhx_cal_prev_button(), !0);
            }(o, r, 200, 100) && (e._block_next_stop = !0), i && (e._ignore_next_click = !0, setTimeout(function() {
              e._ignore_next_click = !1;
            }, 100)), u(m), e._block_next_stop ? (e._block_next_stop = !1, m.preventDefault && m.preventDefault(), m.cancelBubble = !0, !1) : void 0;
        }), e.event(document.body, a[2], u);
      }, e._show_global_tip = function() {
        e._hide_global_tip();
        var a = e._global_tip = document.createElement("div");
        a.className = "dhx_global_tip", e._update_global_tip(1), document.body.appendChild(a);
      }, e._update_global_tip = function(a) {
        var t = e._global_tip;
        if (t) {
          var n = "";
          if (e._drag_id && !a) {
            var o = e.getEvent(e._drag_id);
            o && (n = "<div>" + (o._timed ? e.templates.event_header(o.start_date, o.end_date, o) : e.templates.day_date(o.start_date, o.end_date, o)) + "</div>");
          }
          e._drag_mode == "create" || e._drag_mode == "new-size" ? t.innerHTML = (e.locale.labels.drag_to_create || "Drag to create") + n : t.innerHTML = (e.locale.labels.drag_to_move || "Drag to move") + n;
        }
      }, e._hide_global_tip = function() {
        var a = e._global_tip;
        a && a.parentNode && (a.parentNode.removeChild(a), e._global_tip = 0);
      };
    }
    function extend$6(e) {
      e.getRootView = function() {
        return { view: { render: function() {
          return { tag: "div", type: 1, attrs: { style: "width:100%;height:100%;" }, hooks: { didInsert: function() {
            e.setCurrentView();
          } }, body: [{ el: this.el, type: 1 }] };
        }, init: function() {
          var a = document.createElement("DIV");
          a.id = "scheduler_" + e.uid(), a.style.width = "100%", a.style.height = "100%", a.classList.add("dhx_cal_container"), a.cmp = "grid", a.innerHTML = '<div class="dhx_cal_navline"><div class="dhx_cal_prev_button"></div><div class="dhx_cal_next_button"></div><div class="dhx_cal_today_button"></div><div class="dhx_cal_date"></div><div class="dhx_cal_tab" data-tab="day"></div><div class="dhx_cal_tab" data-tab="week"></div><div class="dhx_cal_tab" data-tab="month"></div></div><div class="dhx_cal_header"></div><div class="dhx_cal_data"></div>', e.init(a), this.el = a;
        } }, type: 4 };
      };
    }
    function extend$5(e) {
      var a, t;
      function n() {
        if (e._is_material_skin())
          return !0;
        if (t !== void 0)
          return t;
        var i = document.createElement("div");
        i.style.position = "absolute", i.style.left = "-9999px", i.style.top = "-9999px", i.innerHTML = "<div class='dhx_cal_container'><div class='dhx_cal_data'><div class='dhx_cal_event'><div class='dhx_body'></div></div><div>", document.body.appendChild(i);
        var s = window.getComputedStyle(i.querySelector(".dhx_body")).getPropertyValue("box-sizing");
        document.body.removeChild(i), (t = s === "border-box") || setTimeout(function() {
          t = void 0;
        }, 1e3);
      }
      function o() {
        if (!e._is_material_skin() && !e._border_box_events()) {
          var i = t;
          t = void 0, a = void 0, i !== n() && e.$container && e.getState().mode && e.setCurrentView();
        }
      }
      function r(i) {
        var s = i.getMinutes();
        return s = s < 10 ? "0" + s : s, "<span class='dhx_scale_h'>" + i.getHours() + "</span><span class='dhx_scale_m'>&nbsp;" + s + "</span>";
      }
      e._addThemeClass = function() {
        document.documentElement.setAttribute("data-scheduler-theme", e.skin);
      }, e._skin_settings = { fix_tab_position: [1, 0], use_select_menu_space: [1, 0], wide_form: [1, 0], hour_size_px: [44, 42], displayed_event_color: ["#ff4a4a", "ffc5ab"], displayed_event_text_color: ["#ffef80", "7e2727"] }, e._skin_xy = { lightbox_additional_height: [90, 50], nav_height: [59, 22], bar_height: [24, 20] }, e._is_material_skin = function() {
        return e.skin ? (e.skin + "").indexOf("material") > -1 : function() {
          if (a === void 0) {
            var i = document.createElement("div");
            i.style.position = "absolute", i.style.left = "-9999px", i.style.top = "-9999px", i.innerHTML = "<div class='dhx_cal_container'><div class='dhx_cal_scale_placeholder'></div><div>", document.body.appendChild(i);
            var s = window.getComputedStyle(i.querySelector(".dhx_cal_scale_placeholder")).getPropertyValue("position");
            a = s === "absolute", setTimeout(function() {
              a = null, i && i.parentNode && i.parentNode.removeChild(i);
            }, 500);
          }
          return a;
        }();
      }, e._build_skin_info = function() {
        (function() {
          const m = e.$container;
          clearInterval(d), m && (d = setInterval(() => {
            const f = getComputedStyle(m).getPropertyValue("--dhx-scheduler-theme");
            f && f !== e.skin && e.setSkin(f);
          }, 100));
        })();
        const i = getComputedStyle(this.$container), s = i.getPropertyValue("--dhx-scheduler-theme");
        let _, l = !!s, h = {}, u = !1;
        if (l) {
          _ = s;
          for (let m in e.xy)
            h[m] = i.getPropertyValue(`--dhx-scheduler-xy-${m}`);
          h.hour_size_px = i.getPropertyValue("--dhx-scheduler-config-hour_size_px"), h.wide_form = i.getPropertyValue("--dhx-scheduler-config-form_wide");
        } else
          _ = function() {
            for (var m = document.getElementsByTagName("link"), f = 0; f < m.length; f++) {
              var y = m[f].href.match("dhtmlxscheduler_([a-z]+).css");
              if (y)
                return y[1];
            }
          }(), u = e._is_material_skin();
        if (e._theme_info = { theme: _, cssVarTheme: l, oldMaterialTheme: u, values: h }, e._theme_info.cssVarTheme) {
          const m = this._theme_info.values;
          for (let f in e.xy)
            isNaN(parseInt(m[f])) || (e.xy[f] = parseInt(m[f]));
        }
      }, e.event(window, "DOMContentLoaded", o), e.event(window, "load", o), e._border_box_events = function() {
        return n();
      }, e._configure = function(i, s, _) {
        for (var l in s)
          i[l] === void 0 && (i[l] = s[l][_]);
      }, e.setSkin = function(i) {
        this.skin = i, e._addThemeClass(), e.$container && (this._skin_init(), this.render());
      };
      let d = null;
      e.attachEvent("onDestroy", function() {
        clearInterval(d);
      }), e._skin_init = function() {
        this._build_skin_info(), this.skin || (this.skin = this._theme_info.theme), e._addThemeClass(), e.skin === "flat" ? e.templates.hour_scale = r : e.templates.hour_scale === r && (e.templates.hour_scale = e.date.date_to_str(e.config.hour_date)), e.attachEvent("onTemplatesReady", function() {
          var i = e.date.date_to_str("%d");
          e.templates._old_month_day || (e.templates._old_month_day = e.templates.month_day);
          var s = e.templates._old_month_day;
          e.templates.month_day = function(_) {
            if (this._mode == "month") {
              var l = i(_);
              return _.getDate() == 1 && (l = e.locale.date.month_full[_.getMonth()] + " " + l), +_ == +e.date.date_part(this._currentDate()) && (l = e.locale.labels.dhx_cal_today_button + " " + l), l;
            }
            return s.call(this, _);
          }, e.config.fix_tab_position && (e._els.dhx_cal_navline[0].querySelectorAll("[data-tab]").forEach((_) => {
            switch (_.getAttribute("data-tab") || _.getAttribute("name")) {
              case "day":
              case "day_tab":
                _.classList.add("dhx_cal_tab_first"), _.classList.add("dhx_cal_tab_segmented");
                break;
              case "week":
              case "week_tab":
                _.classList.add("dhx_cal_tab_segmented");
                break;
              case "month":
              case "month_tab":
                _.classList.add("dhx_cal_tab_last"), _.classList.add("dhx_cal_tab_segmented");
                break;
              default:
                _.classList.add("dhx_cal_tab_standalone");
            }
          }), function(_) {
            if (e.config.header)
              return;
            const l = Array.from(_.querySelectorAll(".dhx_cal_tab")), h = ["day", "week", "month"].map((m) => l.find((f) => f.getAttribute("data-tab") === m)).filter((m) => m !== void 0);
            let u = l.length > 0 ? l[0] : null;
            h.reverse().forEach((m) => {
              _.insertBefore(m, u), u = m;
            });
          }(e._els.dhx_cal_navline[0]));
        }, { once: !0 });
      };
    }
    function extend$4(e) {
      var a, t, n;
      window.jQuery && (a = window.jQuery, t = 0, n = [], a.fn.dhx_scheduler = function(o) {
        if (typeof o != "string") {
          var r = [];
          return this.each(function() {
            if (this && this.getAttribute)
              if (this.getAttribute("dhxscheduler"))
                r.push(window[this.getAttribute("dhxscheduler")]);
              else {
                var d = "scheduler";
                t && (d = "scheduler" + (t + 1), window[d] = Scheduler.getSchedulerInstance());
                var i = window[d];
                for (var s in this.setAttribute("dhxscheduler", d), o)
                  s != "data" && (i.config[s] = o[s]);
                this.getElementsByTagName("div").length || (this.innerHTML = '<div class="dhx_cal_navline"><div class="dhx_cal_prev_button"></div><div class="dhx_cal_next_button"></div><div class="dhx_cal_today_button"></div><div class="dhx_cal_date"></div><div class="dhx_cal_tab" name="day_tab" data-tab="day" style="right:204px;"></div><div class="dhx_cal_tab" name="week_tab" data-tab="week" style="right:140px;"></div><div class="dhx_cal_tab" name="month_tab" data-tab="month" style="right:76px;"></div></div><div class="dhx_cal_header"></div><div class="dhx_cal_data"></div>', this.className += " dhx_cal_container"), i.init(this, i.config.date, i.config.mode), o.data && i.parse(o.data), r.push(i), t++;
              }
          }), r.length === 1 ? r[0] : r;
        }
        if (n[o])
          return n[o].apply(this, []);
        a.error("Method " + o + " does not exist on jQuery.dhx_scheduler");
      });
    }
    function extend$3(e) {
      (function() {
        var a = e.setCurrentView, t = e.updateView, n = null, o = null, r = function(s, _) {
          var l = this;
          global$1.clearTimeout(o), global$1.clearTimeout(n);
          var h = l._date, u = l._mode;
          i(this, s, _), o = setTimeout(function() {
            e.$destroyed || (l.callEvent("onBeforeViewChange", [u, h, _ || l._mode, s || l._date]) ? (t.call(l, s, _), l.callEvent("onViewChange", [l._mode, l._date]), global$1.clearTimeout(n), o = 0) : i(l, h, u));
          }, e.config.delay_render);
        }, d = function(s, _) {
          var l = this, h = arguments;
          i(this, s, _), global$1.clearTimeout(n), n = setTimeout(function() {
            e.$destroyed || o || t.apply(l, h);
          }, e.config.delay_render);
        };
        function i(s, _, l) {
          _ && (s._date = _), l && (s._mode = l);
        }
        e.attachEvent("onSchedulerReady", function() {
          e.config.delay_render ? (e.setCurrentView = r, e.updateView = d) : (e.setCurrentView = a, e.updateView = t);
        });
      })();
    }
    function DataProcessorEvents(e, a) {
      this.$scheduler = e, this.$dp = a, this._dataProcessorHandlers = [], this.attach = function() {
        var t = this.$dp, n = this.$scheduler;
        this._dataProcessorHandlers.push(n.attachEvent("onEventAdded", function(o) {
          !this._loading && this._validId(o) && t.setUpdated(o, !0, "inserted");
        })), this._dataProcessorHandlers.push(n.attachEvent("onConfirmedBeforeEventDelete", function(o) {
          if (this._validId(o)) {
            var r = t.getState(o);
            return r == "inserted" || this._new_event ? (t.setUpdated(o, !1), !0) : r != "deleted" && (r == "true_deleted" || (t.setUpdated(o, !0, "deleted"), !1));
          }
        })), this._dataProcessorHandlers.push(n.attachEvent("onEventChanged", function(o) {
          !this._loading && this._validId(o) && t.setUpdated(o, !0, "updated");
        })), this._dataProcessorHandlers.push(n.attachEvent("onClearAll", function() {
          t._in_progress = {}, t._invalid = {}, t.updatedRows = [], t._waitMode = 0;
        })), t.attachEvent("insertCallback", n._update_callback), t.attachEvent("updateCallback", n._update_callback), t.attachEvent("deleteCallback", function(o, r) {
          n.getEvent(r) ? (n.setUserData(r, this.action_param, "true_deleted"), n.deleteEvent(r)) : n._add_rec_marker && n._update_callback(o, r);
        });
      }, this.detach = function() {
        for (var t in this._dataProcessorHandlers) {
          var n = this._dataProcessorHandlers[t];
          this.$scheduler.detachEvent(n);
        }
        this._dataProcessorHandlers = [];
      };
    }
    function extendScheduler(e, a) {
      e._validId = function(t) {
        return !this._is_virtual_event || !this._is_virtual_event(t);
      }, e.setUserData = function(t, n, o) {
        if (t) {
          var r = this.getEvent(t);
          r && (r[n] = o);
        } else
          this._userdata[n] = o;
      }, e.getUserData = function(t, n) {
        if (t) {
          var o = this.getEvent(t);
          return o ? o[n] : null;
        }
        return this._userdata[n];
      }, e._set_event_text_style = function(t, n) {
        if (e.getEvent(t)) {
          this.for_rendered(t, function(r) {
            r.style.cssText += ";" + n;
          });
          var o = this.getEvent(t);
          o._text_style = n, this.event_updated(o);
        }
      }, e._update_callback = function(t, n) {
        var o = e._xmlNodeToJSON(t.firstChild);
        o.rec_type == "none" && (o.rec_pattern = "none"), o.text = o.text || o._tagvalue, o.start_date = e._helpers.parseDate(o.start_date), o.end_date = e._helpers.parseDate(o.end_date), e.addEvent(o), e._add_rec_marker && e.setCurrentView();
      }, e._dp_change_event_id = function(t, n) {
        e.getEvent(t) && e.changeEventId(t, n);
      }, e._dp_hook_delete = function(t, n) {
        if (e.getEvent(t))
          return n && t != n && (this.getUserData(t, a.action_param) == "true_deleted" && this.setUserData(t, a.action_param, "updated"), this.changeEventId(t, n)), this.deleteEvent(n, !0);
      }, e.setDp = function() {
        this._dp = a;
      }, e.setDp();
    }
    function DataProcessor(e) {
      return this.serverProcessor = e, this.action_param = "!nativeeditor_status", this.object = null, this.updatedRows = [], this.autoUpdate = !0, this.updateMode = "cell", this._tMode = "GET", this._headers = null, this._payload = null, this.post_delim = "_", this._waitMode = 0, this._in_progress = {}, this._invalid = {}, this.messages = [], this.styles = { updated: "font-weight:bold;", inserted: "font-weight:bold;", deleted: "text-decoration : line-through;", invalid: "background-color:FFE0E0;", invalid_cell: "border-bottom:2px solid red;", error: "color:red;", clear: "font-weight:normal;text-decoration:none;" }, this.enableUTFencoding(!0), makeEventable(this), this;
    }
    function extend$2(e) {
      e.createDataProcessor = function(a) {
        var t, n;
        a instanceof Function ? t = a : a.hasOwnProperty("router") ? t = a.router : a.hasOwnProperty("event") && (t = a), n = t ? "CUSTOM" : a.mode || "REST-JSON";
        var o = new DataProcessor(a.url);
        return o.init(e), o.setTransactionMode({ mode: n, router: t }, a.batchUpdate), o;
      }, e.DataProcessor = DataProcessor;
    }
    function message(e) {
      var a = "data-dhxbox", t = null;
      function n(c, g) {
        var v = c.callback;
        f.hide(c.box), t = c.box = null, v && v(g);
      }
      function o(c) {
        if (t) {
          var g = c.which || c.keyCode, v = !1;
          if (y.keyboard) {
            if (g == 13 || g == 32) {
              var p = c.target || c.srcElement;
              dom_helpers.getClassName(p).indexOf("scheduler_popup_button") > -1 && p.click ? p.click() : (n(t, !0), v = !0);
            }
            g == 27 && (n(t, !1), v = !0);
          }
          return v ? (c.preventDefault && c.preventDefault(), !(c.cancelBubble = !0)) : void 0;
        }
      }
      function r(c) {
        r.cover || (r.cover = document.createElement("div"), e.event(r.cover, "keydown", o), r.cover.className = "dhx_modal_cover", document.body.appendChild(r.cover)), r.cover.style.display = c ? "inline-block" : "none";
      }
      function d(c, g, v) {
        var p = e._waiAria.messageButtonAttrString(c), x = (g || "").toLowerCase().replace(/ /g, "_");
        return `<div ${p} class='scheduler_popup_button dhtmlx_popup_button ${`scheduler_${x}_button dhtmlx_${x}_button`}' data-result='${v}' result='${v}' ><div>${c}</div></div>`;
      }
      function i() {
        for (var c = [].slice.apply(arguments, [0]), g = 0; g < c.length; g++)
          if (c[g])
            return c[g];
      }
      function s(c, g, v) {
        var p = c.tagName ? c : function(k, E, D) {
          var S = document.createElement("div"), N = utils.uid();
          e._waiAria.messageModalAttr(S, N), S.className = " scheduler_modal_box dhtmlx_modal_box scheduler-" + k.type + " dhtmlx-" + k.type, S.setAttribute(a, 1);
          var A = "";
          if (k.width && (S.style.width = k.width), k.height && (S.style.height = k.height), k.title && (A += '<div class="scheduler_popup_title dhtmlx_popup_title">' + k.title + "</div>"), A += '<div class="scheduler_popup_text dhtmlx_popup_text" id="' + N + '"><span>' + (k.content ? "" : k.text) + '</span></div><div  class="scheduler_popup_controls dhtmlx_popup_controls">', E && (A += d(i(k.ok, e.locale.labels.message_ok, "OK"), "ok", !0)), D && (A += d(i(k.cancel, e.locale.labels.message_cancel, "Cancel"), "cancel", !1)), k.buttons)
            for (var M = 0; M < k.buttons.length; M++) {
              var C = k.buttons[M];
              A += typeof C == "object" ? d(C.label, C.css || "scheduler_" + C.label.toLowerCase() + "_button dhtmlx_" + C.label.toLowerCase() + "_button", C.value || M) : d(C, C, M);
            }
          if (A += "</div>", S.innerHTML = A, k.content) {
            var T = k.content;
            typeof T == "string" && (T = document.getElementById(T)), T.style.display == "none" && (T.style.display = ""), S.childNodes[k.title ? 1 : 0].appendChild(T);
          }
          return e.event(S, "click", function(O) {
            var L = O.target || O.srcElement;
            if (L.className || (L = L.parentNode), dom_helpers.closest(L, ".scheduler_popup_button")) {
              var $ = L.getAttribute("data-result");
              n(k, $ = $ == "true" || $ != "false" && $);
            }
          }), k.box = S, (E || D) && (t = k), S;
        }(c, g, v);
        c.hidden || r(!0), document.body.appendChild(p);
        var x = Math.abs(Math.floor(((window.innerWidth || document.documentElement.offsetWidth) - p.offsetWidth) / 2)), w = Math.abs(Math.floor(((window.innerHeight || document.documentElement.offsetHeight) - p.offsetHeight) / 2));
        return c.position == "top" ? p.style.top = "-3px" : p.style.top = w + "px", p.style.left = x + "px", e.event(p, "keydown", o), f.focus(p), c.hidden && f.hide(p), e.callEvent("onMessagePopup", [p]), p;
      }
      function _(c) {
        return s(c, !0, !1);
      }
      function l(c) {
        return s(c, !0, !0);
      }
      function h(c) {
        return s(c);
      }
      function u(c, g, v) {
        return typeof c != "object" && (typeof g == "function" && (v = g, g = ""), c = { text: c, type: g, callback: v }), c;
      }
      function m(c, g, v, p) {
        return typeof c != "object" && (c = { text: c, type: g, expire: v, id: p }), c.id = c.id || utils.uid(), c.expire = c.expire || y.expire, c;
      }
      e.event(document, "keydown", o, !0);
      var f = function() {
        var c = u.apply(this, arguments);
        return c.type = c.type || "alert", h(c);
      };
      f.hide = function(c) {
        for (; c && c.getAttribute && !c.getAttribute(a); )
          c = c.parentNode;
        c && (c.parentNode.removeChild(c), r(!1), e.callEvent("onAfterMessagePopup", [c]));
      }, f.focus = function(c) {
        setTimeout(function() {
          var g = dom_helpers.getFocusableNodes(c);
          g.length && g[0].focus && g[0].focus();
        }, 1);
      };
      var y = function(c, g, v, p) {
        switch ((c = m.apply(this, arguments)).type = c.type || "info", c.type.split("-")[0]) {
          case "alert":
            return _(c);
          case "confirm":
            return l(c);
          case "modalbox":
            return h(c);
          default:
            return function(x) {
              y.area || (y.area = document.createElement("div"), y.area.className = "scheduler_message_area dhtmlx_message_area", y.area.style[y.position] = "5px", document.body.appendChild(y.area)), y.hide(x.id);
              var w = document.createElement("div");
              return w.innerHTML = "<div>" + x.text + "</div>", w.className = "scheduler-info dhtmlx-info scheduler-" + x.type + " dhtmlx-" + x.type, e.event(w, "click", function() {
                y.hide(x.id), x = null;
              }), e._waiAria.messageInfoAttr(w), y.position == "bottom" && y.area.firstChild ? y.area.insertBefore(w, y.area.firstChild) : y.area.appendChild(w), x.expire > 0 && (y.timers[x.id] = window.setTimeout(function() {
                y && y.hide(x.id);
              }, x.expire)), y.pull[x.id] = w, w = null, x.id;
            }(c);
        }
      };
      y.seed = (/* @__PURE__ */ new Date()).valueOf(), y.uid = utils.uid, y.expire = 4e3, y.keyboard = !0, y.position = "top", y.pull = {}, y.timers = {}, y.hideAll = function() {
        for (var c in y.pull)
          y.hide(c);
      }, y.hide = function(c) {
        var g = y.pull[c];
        g && g.parentNode && (window.setTimeout(function() {
          g.parentNode.removeChild(g), g = null;
        }, 2e3), g.className += " hidden", y.timers[c] && window.clearTimeout(y.timers[c]), delete y.pull[c]);
      };
      var b = [];
      return e.attachEvent("onMessagePopup", function(c) {
        b.push(c);
      }), e.attachEvent("onAfterMessagePopup", function(c) {
        for (var g = 0; g < b.length; g++)
          b[g] === c && (b.splice(g, 1), g--);
      }), e.attachEvent("onDestroy", function() {
        r.cover && r.cover.parentNode && r.cover.parentNode.removeChild(r.cover);
        for (var c = 0; c < b.length; c++)
          b[c].parentNode && b[c].parentNode.removeChild(b[c]);
        b = null, y.area && y.area.parentNode && y.area.parentNode.removeChild(y.area), y = null;
      }), { alert: function() {
        var c = u.apply(this, arguments);
        return c.type = c.type || "confirm", _(c);
      }, confirm: function() {
        var c = u.apply(this, arguments);
        return c.type = c.type || "alert", l(c);
      }, message: y, modalbox: f };
    }
    DataProcessor.prototype = { setTransactionMode: function(e, a) {
      typeof e == "object" ? (this._tMode = e.mode || this._tMode, e.headers !== void 0 && (this._headers = e.headers), e.payload !== void 0 && (this._payload = e.payload), this._tSend = !!a) : (this._tMode = e, this._tSend = a), this._tMode == "REST" && (this._tSend = !1, this._endnm = !0), this._tMode === "JSON" || this._tMode === "REST-JSON" ? (this._tSend = !1, this._endnm = !0, this._serializeAsJson = !0, this._headers = this._headers || {}, this._headers["Content-Type"] = "application/json") : this._headers && !this._headers["Content-Type"] && (this._headers["Content-Type"] = "application/x-www-form-urlencoded"), this._tMode === "CUSTOM" && (this._tSend = !1, this._endnm = !0, this._router = e.router);
    }, escape: function(e) {
      return this._utf ? encodeURIComponent(e) : escape(e);
    }, enableUTFencoding: function(e) {
      this._utf = !!e;
    }, setDataColumns: function(e) {
      this._columns = typeof e == "string" ? e.split(",") : e;
    }, getSyncState: function() {
      return !this.updatedRows.length;
    }, enableDataNames: function(e) {
      this._endnm = !!e;
    }, enablePartialDataSend: function(e) {
      this._changed = !!e;
    }, setUpdateMode: function(e, a) {
      this.autoUpdate = e == "cell", this.updateMode = e, this.dnd = a;
    }, ignore: function(e, a) {
      this._silent_mode = !0, e.call(a || window), this._silent_mode = !1;
    }, setUpdated: function(e, a, t) {
      if (!this._silent_mode) {
        var n = this.findRow(e);
        t = t || "updated";
        var o = this.$scheduler.getUserData(e, this.action_param);
        o && t == "updated" && (t = o), a ? (this.set_invalid(e, !1), this.updatedRows[n] = e, this.$scheduler.setUserData(e, this.action_param, t), this._in_progress[e] && (this._in_progress[e] = "wait")) : this.is_invalid(e) || (this.updatedRows.splice(n, 1), this.$scheduler.setUserData(e, this.action_param, "")), this.markRow(e, a, t), a && this.autoUpdate && this.sendData(e);
      }
    }, markRow: function(e, a, t) {
      var n = "", o = this.is_invalid(e);
      if (o && (n = this.styles[o], a = !0), this.callEvent("onRowMark", [e, a, t, o]) && (n = this.styles[a ? t : "clear"] + n, this.$scheduler[this._methods[0]](e, n), o && o.details)) {
        n += this.styles[o + "_cell"];
        for (var r = 0; r < o.details.length; r++)
          o.details[r] && this.$scheduler[this._methods[1]](e, r, n);
      }
    }, getActionByState: function(e) {
      return e === "inserted" ? "create" : e === "updated" ? "update" : e === "deleted" ? "delete" : "update";
    }, getState: function(e) {
      return this.$scheduler.getUserData(e, this.action_param);
    }, is_invalid: function(e) {
      return this._invalid[e];
    }, set_invalid: function(e, a, t) {
      t && (a = { value: a, details: t, toString: function() {
        return this.value.toString();
      } }), this._invalid[e] = a;
    }, checkBeforeUpdate: function(e) {
      return !0;
    }, sendData: function(e) {
      return this.$scheduler.editStop && this.$scheduler.editStop(), e === void 0 || this._tSend ? this.sendAllData() : !this._in_progress[e] && (this.messages = [], !(!this.checkBeforeUpdate(e) && this.callEvent("onValidationError", [e, this.messages])) && void this._beforeSendData(this._getRowData(e), e));
    }, _beforeSendData: function(e, a) {
      if (!this.callEvent("onBeforeUpdate", [a, this.getState(a), e]))
        return !1;
      this._sendData(e, a);
    }, serialize: function(e, a) {
      if (this._serializeAsJson)
        return this._serializeAsJSON(e);
      if (typeof e == "string")
        return e;
      if (a !== void 0)
        return this.serialize_one(e, "");
      var t = [], n = [];
      for (var o in e)
        e.hasOwnProperty(o) && (t.push(this.serialize_one(e[o], o + this.post_delim)), n.push(o));
      return t.push("ids=" + this.escape(n.join(","))), this.$scheduler.security_key && t.push("dhx_security=" + this.$scheduler.security_key), t.join("&");
    }, serialize_one: function(e, a) {
      if (typeof e == "string")
        return e;
      var t = [], n = "";
      for (var o in e)
        if (e.hasOwnProperty(o)) {
          if ((o == "id" || o == this.action_param) && this._tMode == "REST")
            continue;
          n = typeof e[o] == "string" || typeof e[o] == "number" ? e[o] : JSON.stringify(e[o]), t.push(this.escape((a || "") + o) + "=" + this.escape(n));
        }
      return t.join("&");
    }, _applyPayload: function(e) {
      var a = this.$scheduler.ajax;
      if (this._payload)
        for (var t in this._payload)
          e = e + a.urlSeparator(e) + this.escape(t) + "=" + this.escape(this._payload[t]);
      return e;
    }, _sendData: function(e, a) {
      if (e) {
        if (!this.callEvent("onBeforeDataSending", a ? [a, this.getState(a), e] : [null, null, e]))
          return !1;
        a && (this._in_progress[a] = (/* @__PURE__ */ new Date()).valueOf());
        var t = this, n = this.$scheduler.ajax;
        if (this._tMode !== "CUSTOM") {
          var o, r = { callback: function(f) {
            var y = [];
            if (a)
              y.push(a);
            else if (e)
              for (var b in e)
                y.push(b);
            return t.afterUpdate(t, f, y);
          }, headers: t._headers }, d = this.serverProcessor + (this._user ? n.urlSeparator(this.serverProcessor) + ["dhx_user=" + this._user, "dhx_version=" + this.$scheduler.getUserData(0, "version")].join("&") : ""), i = this._applyPayload(d);
          switch (this._tMode) {
            case "GET":
              o = this._cleanupArgumentsBeforeSend(e), r.url = i + n.urlSeparator(i) + this.serialize(o, a), r.method = "GET";
              break;
            case "POST":
              o = this._cleanupArgumentsBeforeSend(e), r.url = i, r.method = "POST", r.data = this.serialize(o, a);
              break;
            case "JSON":
              o = {};
              var s = this._cleanupItemBeforeSend(e);
              for (var _ in s)
                _ !== this.action_param && _ !== "id" && _ !== "gr_id" && (o[_] = s[_]);
              r.url = i, r.method = "POST", r.data = JSON.stringify({ id: a, action: e[this.action_param], data: o });
              break;
            case "REST":
            case "REST-JSON":
              switch (i = d.replace(/(&|\?)editing=true/, ""), o = "", this.getState(a)) {
                case "inserted":
                  r.method = "POST", r.data = this.serialize(e, a);
                  break;
                case "deleted":
                  r.method = "DELETE", i = i + (i.slice(-1) === "/" ? "" : "/") + a;
                  break;
                default:
                  r.method = "PUT", r.data = this.serialize(e, a), i = i + (i.slice(-1) === "/" ? "" : "/") + a;
              }
              r.url = this._applyPayload(i);
          }
          return this._waitMode++, n.query(r);
        }
        {
          var l = this.getState(a), h = this.getActionByState(l), u = function(y) {
            var b = l;
            if (y && y.responseText && y.setRequestHeader) {
              y.status !== 200 && (b = "error");
              try {
                y = JSON.parse(y.responseText);
              } catch {
              }
            }
            b = b || "updated";
            var c = a, g = a;
            y && (b = y.action || b, c = y.sid || c, g = y.id || y.tid || g), t.afterUpdateCallback(c, g, b, y);
          };
          const f = "event";
          var m;
          if (this._router instanceof Function)
            m = this._router(f, h, e, a);
          else
            switch (l) {
              case "inserted":
                m = this._router[f].create(e);
                break;
              case "deleted":
                m = this._router[f].delete(a);
                break;
              default:
                m = this._router[f].update(e, a);
            }
          if (m) {
            if (!m.then && m.id === void 0 && m.tid === void 0 && m.action === void 0)
              throw new Error("Incorrect router return value. A Promise or a response object is expected");
            m.then ? m.then(u).catch(function(y) {
              y && y.action ? u(y) : u({ action: "error", value: y });
            }) : u(m);
          } else
            u(null);
        }
      }
    }, sendAllData: function() {
      if (this.updatedRows.length && this.updateMode !== "off") {
        this.messages = [];
        var e = !0;
        if (this._forEachUpdatedRow(function(a) {
          e = e && this.checkBeforeUpdate(a);
        }), !e && !this.callEvent("onValidationError", ["", this.messages]))
          return !1;
        this._tSend ? this._sendData(this._getAllData()) : this._forEachUpdatedRow(function(a) {
          if (!this._in_progress[a]) {
            if (this.is_invalid(a))
              return;
            this._beforeSendData(this._getRowData(a), a);
          }
        });
      }
    }, _getAllData: function(e) {
      var a = {}, t = !1;
      return this._forEachUpdatedRow(function(n) {
        if (!this._in_progress[n] && !this.is_invalid(n)) {
          var o = this._getRowData(n);
          this.callEvent("onBeforeUpdate", [n, this.getState(n), o]) && (a[n] = o, t = !0, this._in_progress[n] = (/* @__PURE__ */ new Date()).valueOf());
        }
      }), t ? a : null;
    }, findRow: function(e) {
      var a = 0;
      for (a = 0; a < this.updatedRows.length && e != this.updatedRows[a]; a++)
        ;
      return a;
    }, defineAction: function(e, a) {
      this._uActions || (this._uActions = {}), this._uActions[e] = a;
    }, afterUpdateCallback: function(e, a, t, n) {
      if (this.$scheduler) {
        var o = e, r = t !== "error" && t !== "invalid";
        if (r || this.set_invalid(e, t), this._uActions && this._uActions[t] && !this._uActions[t](n))
          return delete this._in_progress[o];
        this._in_progress[o] !== "wait" && this.setUpdated(e, !1);
        var d = e;
        switch (t) {
          case "inserted":
          case "insert":
            a != e && (this.setUpdated(e, !1), this.$scheduler[this._methods[2]](e, a), e = a);
            break;
          case "delete":
          case "deleted":
            return this.$scheduler.setUserData(e, this.action_param, "true_deleted"), this.$scheduler[this._methods[3]](e, a), delete this._in_progress[o], this.callEvent("onAfterUpdate", [e, t, a, n]);
        }
        this._in_progress[o] !== "wait" ? (r && this.$scheduler.setUserData(e, this.action_param, ""), delete this._in_progress[o]) : (delete this._in_progress[o], this.setUpdated(a, !0, this.$scheduler.getUserData(e, this.action_param))), this.callEvent("onAfterUpdate", [d, t, a, n]);
      }
    }, _errorResponse: function(e, a) {
      return this.$scheduler && this.$scheduler.callEvent && this.$scheduler.callEvent("onSaveError", [a, e.xmlDoc]), this.cleanUpdate(a);
    }, _setDefaultTransactionMode: function() {
      this.serverProcessor && (this.setTransactionMode("POST", !0), this.serverProcessor += (this.serverProcessor.indexOf("?") !== -1 ? "&" : "?") + "editing=true", this._serverProcessor = this.serverProcessor);
    }, afterUpdate: function(e, a, t) {
      var n = this.$scheduler.ajax;
      if (a.xmlDoc.status === 200) {
        var o;
        try {
          o = JSON.parse(a.xmlDoc.responseText);
        } catch {
          a.xmlDoc.responseText.length || (o = {});
        }
        if (o) {
          var r = o.action || this.getState(t) || "updated", d = o.sid || t[0], i = o.tid || t[0];
          return e.afterUpdateCallback(d, i, r, o), void e.finalizeUpdate();
        }
        var s = n.xmltop("data", a.xmlDoc);
        if (!s)
          return this._errorResponse(a, t);
        var _ = n.xpath("//data/action", s);
        if (!_.length)
          return this._errorResponse(a, t);
        for (var l = 0; l < _.length; l++) {
          var h = _[l];
          r = h.getAttribute("type"), d = h.getAttribute("sid"), i = h.getAttribute("tid"), e.afterUpdateCallback(d, i, r, h);
        }
        e.finalizeUpdate();
      } else
        this._errorResponse(a, t);
    }, cleanUpdate: function(e) {
      if (e)
        for (var a = 0; a < e.length; a++)
          delete this._in_progress[e[a]];
    }, finalizeUpdate: function() {
      this._waitMode && this._waitMode--, this.callEvent("onAfterUpdateFinish", []), this.updatedRows.length || this.callEvent("onFullSync", []);
    }, init: function(e) {
      if (!this._initialized) {
        this.$scheduler = e, this.$scheduler._dp_init && this.$scheduler._dp_init(this), this._setDefaultTransactionMode(), this._methods = this._methods || ["_set_event_text_style", "", "_dp_change_event_id", "_dp_hook_delete"], extendScheduler(this.$scheduler, this);
        var a = new DataProcessorEvents(this.$scheduler, this);
        a.attach(), this.attachEvent("onDestroy", function() {
          delete this._getRowData, delete this.$scheduler._dp, delete this.$scheduler._dataprocessor, delete this.$scheduler._set_event_text_style, delete this.$scheduler._dp_change_event_id, delete this.$scheduler._dp_hook_delete, delete this.$scheduler, a.detach();
        }), this.$scheduler.callEvent("onDataProcessorReady", [this]), this._initialized = !0, e._dataprocessor = this;
      }
    }, setOnAfterUpdate: function(e) {
      this.attachEvent("onAfterUpdate", e);
    }, setOnBeforeUpdateHandler: function(e) {
      this.attachEvent("onBeforeDataSending", e);
    }, setAutoUpdate: function(e, a) {
      e = e || 2e3, this._user = a || (/* @__PURE__ */ new Date()).valueOf(), this._need_update = !1, this._update_busy = !1, this.attachEvent("onAfterUpdate", function(o, r, d, i) {
        this.afterAutoUpdate(o, r, d, i);
      }), this.attachEvent("onFullSync", function() {
        this.fullSync();
      });
      var t = this;
      let n = global$1.setInterval(function() {
        t.loadUpdate();
      }, e);
      this.attachEvent("onDestroy", function() {
        clearInterval(n);
      });
    }, afterAutoUpdate: function(e, a, t, n) {
      return a != "collision" || (this._need_update = !0, !1);
    }, fullSync: function() {
      return this._need_update && (this._need_update = !1, this.loadUpdate()), !0;
    }, getUpdates: function(e, a) {
      var t = this.$scheduler.ajax;
      if (this._update_busy)
        return !1;
      this._update_busy = !0, t.get(e, a);
    }, _getXmlNodeValue: function(e) {
      return e.firstChild ? e.firstChild.nodeValue : "";
    }, loadUpdate: function() {
      var e = this, a = this.$scheduler.ajax, t = this.$scheduler.getUserData(0, "version"), n = this.serverProcessor + a.urlSeparator(this.serverProcessor) + ["dhx_user=" + this._user, "dhx_version=" + t].join("&");
      n = n.replace("editing=true&", ""), this.getUpdates(n, function(o) {
        var r = a.xpath("//userdata", o);
        e.$scheduler.setUserData(0, "version", e._getXmlNodeValue(r[0]));
        var d = a.xpath("//update", o);
        if (d.length) {
          e._silent_mode = !0;
          for (var i = 0; i < d.length; i++) {
            var s = d[i].getAttribute("status"), _ = d[i].getAttribute("id"), l = d[i].getAttribute("parent");
            switch (s) {
              case "inserted":
                this.callEvent("insertCallback", [d[i], _, l]);
                break;
              case "updated":
                this.callEvent("updateCallback", [d[i], _, l]);
                break;
              case "deleted":
                this.callEvent("deleteCallback", [d[i], _, l]);
            }
          }
          e._silent_mode = !1;
        }
        e._update_busy = !1, e = null;
      });
    }, destructor: function() {
      this.callEvent("onDestroy", []), this.detachAllEvents(), this.updatedRows = [], this._in_progress = {}, this._invalid = {}, this._headers = null, this._payload = null, delete this._initialized;
    }, url: function(e) {
      this.serverProcessor = this._serverProcessor = e;
    }, _serializeAsJSON: function(e) {
      if (typeof e == "string")
        return e;
      var a = this.$scheduler.utils.copy(e);
      return this._tMode === "REST-JSON" && (delete a.id, delete a[this.action_param]), JSON.stringify(a);
    }, _cleanupArgumentsBeforeSend: function(e) {
      var a;
      if (e[this.action_param] === void 0)
        for (var t in a = {}, e)
          a[t] = this._cleanupArgumentsBeforeSend(e[t]);
      else
        a = this._cleanupItemBeforeSend(e);
      return a;
    }, _cleanupItemBeforeSend: function(e) {
      var a = null;
      return e && (e[this.action_param] === "deleted" ? ((a = {}).id = e.id, a[this.action_param] = e[this.action_param]) : a = e), a;
    }, _forEachUpdatedRow: function(e) {
      for (var a = this.updatedRows.slice(), t = 0; t < a.length; t++) {
        var n = a[t];
        this.$scheduler.getUserData(n, this.action_param) && e.call(this, n);
      }
    }, _prepareDataItem: function(e) {
      var a = {}, t = this.$scheduler, n = t.utils.copy(e);
      for (var o in n)
        o.indexOf("_") !== 0 && n[o] && (n[o].getUTCFullYear ? a[o] = t._helpers.formatDate(n[o]) : typeof n[o] == "object" ? a[o] = this._prepareDataItem(n[o]) : n[o] === null ? a[o] = "" : a[o] = n[o]);
      return a[this.action_param] = t.getUserData(e.id, this.action_param), a;
    }, _getRowData: function(e) {
      var a = this.$scheduler.getEvent(e);
      return a || (a = { id: e }), this._prepareDataItem(a);
    } };
    const ar = { date: { month_full: ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"], month_short: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"], day_full: ["الأحد", "الأثنين", "ألثلاثاء", "الأربعاء", "ألحميس", "ألجمعة", "السبت"], day_short: ["احد", "اثنين", "ثلاثاء", "اربعاء", "خميس", "جمعة", "سبت"] }, labels: { dhx_cal_today_button: "اليوم", day_tab: "يوم", week_tab: "أسبوع", month_tab: "شهر", new_event: "حدث جديد", icon_save: "اخزن", icon_cancel: "الغاء", icon_details: "تفاصيل", icon_edit: "تحرير", icon_delete: "حذف", confirm_closing: "التغييرات سوف تضيع, هل انت متأكد؟", confirm_deleting: "الحدث سيتم حذفها نهائيا ، هل أنت متأكد؟", section_description: "الوصف", section_time: "الفترة الزمنية", full_day: "طوال اليوم", confirm_recurring: "هل تريد تحرير مجموعة كاملة من الأحداث المتكررة؟", section_recurring: "تكرار الحدث", button_recurring: "تعطيل", button_recurring_open: "تمكين", button_edit_series: "تحرير سلسلة", button_edit_occurrence: "تعديل نسخة", grid_tab: "جدول", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, be = { date: { month_full: ["Студзень", "Люты", "Сакавік", "Красавік", "Maй", "Чэрвень", "Ліпень", "Жнівень", "Верасень", "Кастрычнік", "Лістапад", "Снежань"], month_short: ["Студз", "Лют", "Сак", "Крас", "Maй", "Чэр", "Ліп", "Жнів", "Вер", "Каст", "Ліст", "Снеж"], day_full: ["Нядзеля", "Панядзелак", "Аўторак", "Серада", "Чацвер", "Пятніца", "Субота"], day_short: ["Нд", "Пн", "Аўт", "Ср", "Чцв", "Пт", "Сб"] }, labels: { dhx_cal_today_button: "Сёння", day_tab: "Дзень", week_tab: "Тыдзень", month_tab: "Месяц", new_event: "Новая падзея", icon_save: "Захаваць", icon_cancel: "Адмяніць", icon_details: "Дэталі", icon_edit: "Змяніць", icon_delete: "Выдаліць", confirm_closing: "", confirm_deleting: "Падзея будзе выдалена незваротна, працягнуць?", section_description: "Апісанне", section_time: "Перыяд часу", full_day: "Увесь дзень", confirm_recurring: "Вы хочаце змяніць усю серыю паўтаральных падзей?", section_recurring: "Паўтарэнне", button_recurring: "Адключана", button_recurring_open: "Уключана", button_edit_series: "Рэдагаваць серыю", button_edit_occurrence: "Рэдагаваць асобнік", agenda_tab: "Спіс", date: "Дата", description: "Апісанне", year_tab: "Год", week_agenda_tab: "Спіс", grid_tab: "Спic", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Дзень", repeat_radio_week: "Тыдзень", repeat_radio_month: "Месяц", repeat_radio_year: "Год", repeat_radio_day_type: "Кожны", repeat_text_day_count: "дзень", repeat_radio_day_type2: "Кожны працоўны дзень", repeat_week: " Паўтараць кожны", repeat_text_week_count: "тыдзень", repeat_radio_month_type: "Паўтараць", repeat_radio_month_start: "", repeat_text_month_day: " чысла кожнага", repeat_text_month_count: "месяцу", repeat_text_month_count2_before: "кожны ", repeat_text_month_count2_after: "месяц", repeat_year_label: "", select_year_day2: "", repeat_text_year_day: "дзень", select_year_month: "", repeat_radio_end: "Без даты заканчэння", repeat_text_occurences_count: "паўтораў", repeat_radio_end2: "", repeat_radio_end3: "Да ", month_for_recurring: ["Студзеня", "Лютага", "Сакавіка", "Красавіка", "Мая", "Чэрвеня", "Ліпeня", "Жніўня", "Верасня", "Кастрычніка", "Лістапада", "Снежня"], day_for_recurring: ["Нядзелю", "Панядзелак", "Аўторак", "Сераду", "Чацвер", "Пятніцу", "Суботу"] } }, ca = { date: { month_full: ["Gener", "Febrer", "Març", "Abril", "Maig", "Juny", "Juliol", "Agost", "Setembre", "Octubre", "Novembre", "Desembre"], month_short: ["Gen", "Feb", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Des"], day_full: ["Diumenge", "Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte"], day_short: ["Dg", "Dl", "Dm", "Dc", "Dj", "Dv", "Ds"] }, labels: { dhx_cal_today_button: "Hui", day_tab: "Dia", week_tab: "Setmana", month_tab: "Mes", new_event: "Nou esdeveniment", icon_save: "Guardar", icon_cancel: "Cancel·lar", icon_details: "Detalls", icon_edit: "Editar", icon_delete: "Esborrar", confirm_closing: "", confirm_deleting: "L'esdeveniment s'esborrarà definitivament, continuar ?", section_description: "Descripció", section_time: "Periode de temps", full_day: "Tot el dia", confirm_recurring: "¿Desitja modificar el conjunt d'esdeveniments repetits?", section_recurring: "Repeteixca l'esdeveniment", button_recurring: "Impedit", button_recurring_open: "Permés", button_edit_series: "Edit sèrie", button_edit_occurrence: "Edita Instància", agenda_tab: "Agenda", date: "Data", description: "Descripció", year_tab: "Any", week_agenda_tab: "Agenda", grid_tab: "Taula", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, cn = { date: { month_full: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"], month_short: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"], day_full: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"], day_short: ["日", "一", "二", "三", "四", "五", "六"] }, labels: { dhx_cal_today_button: "今天", day_tab: "日", week_tab: "周", month_tab: "月", new_event: "新建日程", icon_save: "保存", icon_cancel: "关闭", icon_details: "详细", icon_edit: "编辑", icon_delete: "删除", confirm_closing: "请确认是否撤销修改!", confirm_deleting: "是否删除日程?", section_description: "描述", section_time: "时间范围", full_day: "整天", confirm_recurring: "请确认是否将日程设为重复模式?", section_recurring: "重复周期", button_recurring: "禁用", button_recurring_open: "启用", button_edit_series: "编辑系列", button_edit_occurrence: "编辑实例", agenda_tab: "议程", date: "日期", description: "说明", year_tab: "今年", week_agenda_tab: "议程", grid_tab: "电网", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "按天", repeat_radio_week: "按周", repeat_radio_month: "按月", repeat_radio_year: "按年", repeat_radio_day_type: "每", repeat_text_day_count: "天", repeat_radio_day_type2: "每个工作日", repeat_week: " 重复 每", repeat_text_week_count: "星期的:", repeat_radio_month_type: "重复", repeat_radio_month_start: "在", repeat_text_month_day: "日 每", repeat_text_month_count: "月", repeat_text_month_count2_before: "每", repeat_text_month_count2_after: "月", repeat_year_label: "在", select_year_day2: "的", repeat_text_year_day: "日", select_year_month: "月", repeat_radio_end: "无结束日期", repeat_text_occurences_count: "次结束", repeat_radio_end2: "重复", repeat_radio_end3: "结束于", month_for_recurring: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"], day_for_recurring: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] } }, cs = { date: { month_full: ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"], month_short: ["Led", "Ún", "Bře", "Dub", "Kvě", "Čer", "Čec", "Srp", "Září", "Říj", "List", "Pro"], day_full: ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"], day_short: ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"] }, labels: { dhx_cal_today_button: "Dnes", day_tab: "Den", week_tab: "Týden", month_tab: "Měsíc", new_event: "Nová událost", icon_save: "Uložit", icon_cancel: "Zpět", icon_details: "Detail", icon_edit: "Edituj", icon_delete: "Smazat", confirm_closing: "", confirm_deleting: "Událost bude trvale smazána, opravdu?", section_description: "Poznámky", section_time: "Doba platnosti", confirm_recurring: "Přejete si upravit celou řadu opakovaných událostí?", section_recurring: "Opakování události", button_recurring: "Vypnuto", button_recurring_open: "Zapnuto", button_edit_series: "Edit series", button_edit_occurrence: "Upravit instance", agenda_tab: "Program", date: "Datum", description: "Poznámka", year_tab: "Rok", full_day: "Full day", week_agenda_tab: "Program", grid_tab: "Mřížka", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Denně", repeat_radio_week: "Týdně", repeat_radio_month: "Měsíčně", repeat_radio_year: "Ročně", repeat_radio_day_type: "každý", repeat_text_day_count: "Den", repeat_radio_day_type2: "pracovní dny", repeat_week: "Opakuje každých", repeat_text_week_count: "Týdnů na:", repeat_radio_month_type: "u každého", repeat_radio_month_start: "na", repeat_text_month_day: "Den každého", repeat_text_month_count: "Měsíc", repeat_text_month_count2_before: "každý", repeat_text_month_count2_after: "Měsíc", repeat_year_label: "na", select_year_day2: "v", repeat_text_year_day: "Den v", select_year_month: "", repeat_radio_end: "bez data ukončení", repeat_text_occurences_count: "Události", repeat_radio_end2: "po", repeat_radio_end3: "Konec", month_for_recurring: ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"], day_for_recurring: ["Neděle ", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"] } }, da = { date: { month_full: ["Januar", "Februar", "Marts", "April", "Maj", "Juni", "Juli", "August", "September", "Oktober", "November", "December"], month_short: ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"], day_full: ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"], day_short: ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"] }, labels: { dhx_cal_today_button: "Idag", day_tab: "Dag", week_tab: "Uge", month_tab: "Måned", new_event: "Ny begivenhed", icon_save: "Gem", icon_cancel: "Fortryd", icon_details: "Detaljer", icon_edit: "Tilret", icon_delete: "Slet", confirm_closing: "Dine rettelser vil gå tabt.. Er dy sikker?", confirm_deleting: "Bigivenheden vil blive slettet permanent. Er du sikker?", section_description: "Beskrivelse", section_time: "Tidsperiode", confirm_recurring: "Vil du tilrette hele serien af gentagne begivenheder?", section_recurring: "Gentag begivenhed", button_recurring: "Frakoblet", button_recurring_open: "Tilkoblet", button_edit_series: "Rediger serien", button_edit_occurrence: "Rediger en kopi", agenda_tab: "Dagsorden", date: "Dato", description: "Beskrivelse", year_tab: "År", week_agenda_tab: "Dagsorden", grid_tab: "Grid", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Daglig", repeat_radio_week: "Ugenlig", repeat_radio_month: "Månedlig", repeat_radio_year: "Årlig", repeat_radio_day_type: "Hver", repeat_text_day_count: "dag", repeat_radio_day_type2: "På hver arbejdsdag", repeat_week: " Gentager sig hver", repeat_text_week_count: "uge på følgende dage:", repeat_radio_month_type: "Hver den", repeat_radio_month_start: "Den", repeat_text_month_day: " i hver", repeat_text_month_count: "måned", repeat_text_month_count2_before: "hver", repeat_text_month_count2_after: "måned", repeat_year_label: "Den", select_year_day2: "i", repeat_text_year_day: "dag i", select_year_month: "", repeat_radio_end: "Ingen slutdato", repeat_text_occurences_count: "gentagelse", repeat_radio_end2: "Efter", repeat_radio_end3: "Slut", month_for_recurring: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"], day_for_recurring: ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"] } }, de = { date: { month_full: [" Januar", " Februar", " März ", " April", " Mai", " Juni", " Juli", " August", " September ", " Oktober", " November ", " Dezember"], month_short: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"], day_full: ["Sonntag", "Montag", "Dienstag", " Mittwoch", " Donnerstag", "Freitag", "Samstag"], day_short: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] }, labels: { dhx_cal_today_button: "Heute", day_tab: "Tag", week_tab: "Woche", month_tab: "Monat", new_event: "neuer Eintrag", icon_save: "Speichern", icon_cancel: "Abbrechen", icon_details: "Details", icon_edit: "Ändern", icon_delete: "Löschen", confirm_closing: "", confirm_deleting: "Der Eintrag wird gelöscht", section_description: "Beschreibung", section_time: "Zeitspanne", full_day: "Ganzer Tag", confirm_recurring: "Wollen Sie alle Einträge bearbeiten oder nur diesen einzelnen Eintrag?", section_recurring: "Wiederholung", button_recurring: "Aus", button_recurring_open: "An", button_edit_series: "Bearbeiten Sie die Serie", button_edit_occurrence: "Bearbeiten Sie eine Kopie", agenda_tab: "Agenda", date: "Datum", description: "Beschreibung", year_tab: "Jahre", week_agenda_tab: "Agenda", grid_tab: "Grid", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Täglich", repeat_radio_week: "Wöchentlich", repeat_radio_month: "Monatlich", repeat_radio_year: "Jährlich", repeat_radio_day_type: "jeden", repeat_text_day_count: "Tag", repeat_radio_day_type2: "an jedem Arbeitstag", repeat_week: " Wiederholt sich jede", repeat_text_week_count: "Woche am:", repeat_radio_month_type: "an jedem", repeat_radio_month_start: "am", repeat_text_month_day: "Tag eines jeden", repeat_text_month_count: "Monats", repeat_text_month_count2_before: "jeden", repeat_text_month_count2_after: "Monats", repeat_year_label: "am", select_year_day2: "im", repeat_text_year_day: "Tag im", select_year_month: "", repeat_radio_end: "kein Enddatum", repeat_text_occurences_count: "Ereignissen", repeat_radio_end3: "Schluß", repeat_radio_end2: "nach", month_for_recurring: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"], day_for_recurring: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] } }, el = { date: { month_full: ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάϊος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"], month_short: ["ΙΑΝ", "ΦΕΒ", "ΜΑΡ", "ΑΠΡ", "ΜΑΙ", "ΙΟΥΝ", "ΙΟΥΛ", "ΑΥΓ", "ΣΕΠ", "ΟΚΤ", "ΝΟΕ", "ΔΕΚ"], day_full: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"], day_short: ["ΚΥ", "ΔΕ", "ΤΡ", "ΤΕ", "ΠΕ", "ΠΑ", "ΣΑ"] }, labels: { dhx_cal_today_button: "Σήμερα", day_tab: "Ημέρα", week_tab: "Εβδομάδα", month_tab: "Μήνας", new_event: "Νέο έργο", icon_save: "Αποθήκευση", icon_cancel: "Άκυρο", icon_details: "Λεπτομέρειες", icon_edit: "Επεξεργασία", icon_delete: "Διαγραφή", confirm_closing: "", confirm_deleting: "Το έργο θα διαγραφεί οριστικά. Θέλετε να συνεχίσετε;", section_description: "Περιγραφή", section_time: "Χρονική περίοδος", full_day: "Πλήρης Ημέρα", confirm_recurring: "Θέλετε να επεξεργασθείτε ολόκληρη την ομάδα των επαναλαμβανόμενων έργων;", section_recurring: "Επαναλαμβανόμενο έργο", button_recurring: "Ανενεργό", button_recurring_open: "Ενεργό", button_edit_series: "Επεξεργαστείτε τη σειρά", button_edit_occurrence: "Επεξεργασία ένα αντίγραφο", agenda_tab: "Ημερήσια Διάταξη", date: "Ημερομηνία", description: "Περιγραφή", year_tab: "Έτος", week_agenda_tab: "Ημερήσια Διάταξη", grid_tab: "Πλέγμα", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Ημερησίως", repeat_radio_week: "Εβδομαδιαίως", repeat_radio_month: "Μηνιαίως", repeat_radio_year: "Ετησίως", repeat_radio_day_type: "Κάθε", repeat_text_day_count: "ημέρα", repeat_radio_day_type2: "Κάθε εργάσιμη", repeat_week: " Επανάληψη κάθε", repeat_text_week_count: "εβδομάδα τις επόμενες ημέρες:", repeat_radio_month_type: "Επανάληψη", repeat_radio_month_start: "Την", repeat_text_month_day: "ημέρα κάθε", repeat_text_month_count: "μήνα", repeat_text_month_count2_before: "κάθε", repeat_text_month_count2_after: "μήνα", repeat_year_label: "Την", select_year_day2: "του", repeat_text_year_day: "ημέρα", select_year_month: "μήνα", repeat_radio_end: "Χωρίς ημερομηνία λήξεως", repeat_text_occurences_count: "επαναλήψεις", repeat_radio_end3: "Λήγει την", repeat_radio_end2: "Μετά από", month_for_recurring: ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάϊος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"], day_for_recurring: ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"] } }, en = { date: { month_full: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], month_short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], day_full: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], day_short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] }, labels: { dhx_cal_today_button: "Today", day_tab: "Day", week_tab: "Week", month_tab: "Month", new_event: "New event", icon_save: "Save", icon_cancel: "Cancel", icon_details: "Details", icon_edit: "Edit", icon_delete: "Delete", confirm_closing: "", confirm_deleting: "Event will be deleted permanently, are you sure?", section_description: "Description", section_time: "Time period", full_day: "Full day", confirm_recurring: "Do you want to edit the whole set of repeated events?", section_recurring: "Repeat event", button_recurring: "Disabled", button_recurring_open: "Enabled", button_edit_series: "Edit series", button_edit_occurrence: "Edit occurrence", agenda_tab: "Agenda", date: "Date", description: "Description", year_tab: "Year", week_agenda_tab: "Agenda", grid_tab: "Grid", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Daily", repeat_radio_week: "Weekly", repeat_radio_month: "Monthly", repeat_radio_year: "Yearly", repeat_radio_day_type: "Every", repeat_text_day_count: "day", repeat_radio_day_type2: "Every workday", repeat_week: " Repeat every", repeat_text_week_count: "week next days:", repeat_radio_month_type: "Repeat", repeat_radio_month_start: "On", repeat_text_month_day: "day every", repeat_text_month_count: "month", repeat_text_month_count2_before: "every", repeat_text_month_count2_after: "month", repeat_year_label: "On", select_year_day2: "of", repeat_text_year_day: "day", select_year_month: "month", repeat_radio_end: "No end date", repeat_text_occurences_count: "occurrences", repeat_radio_end2: "After", repeat_radio_end3: "End by", month_for_recurring: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], day_for_recurring: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] } }, es = { date: { month_full: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"], month_short: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"], day_full: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"], day_short: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] }, labels: { dhx_cal_today_button: "Hoy", day_tab: "Día", week_tab: "Semana", month_tab: "Mes", new_event: "Nuevo evento", icon_save: "Guardar", icon_cancel: "Cancelar", icon_details: "Detalles", icon_edit: "Editar", icon_delete: "Eliminar", confirm_closing: "", confirm_deleting: "El evento se borrará definitivamente, ¿continuar?", section_description: "Descripción", section_time: "Período", full_day: "Todo el día", confirm_recurring: "¿Desea modificar el conjunto de eventos repetidos?", section_recurring: "Repita el evento", button_recurring: "Impedido", button_recurring_open: "Permitido", button_edit_series: "Editar la serie", button_edit_occurrence: "Editar este evento", agenda_tab: "Día", date: "Fecha", description: "Descripción", year_tab: "Año", week_agenda_tab: "Día", grid_tab: "Reja", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Diariamente", repeat_radio_week: "Semanalmente", repeat_radio_month: "Mensualmente", repeat_radio_year: "Anualmente", repeat_radio_day_type: "Cada", repeat_text_day_count: "dia", repeat_radio_day_type2: "Cada jornada de trabajo", repeat_week: " Repetir cada", repeat_text_week_count: "semana:", repeat_radio_month_type: "Repita", repeat_radio_month_start: "El", repeat_text_month_day: "dia cada ", repeat_text_month_count: "mes", repeat_text_month_count2_before: "cada", repeat_text_month_count2_after: "mes", repeat_year_label: "El", select_year_day2: "del", repeat_text_year_day: "dia", select_year_month: "mes", repeat_radio_end: "Sin fecha de finalización", repeat_text_occurences_count: "ocurrencias", repeat_radio_end3: "Fin", repeat_radio_end2: "Después de", month_for_recurring: ["Enero", "Febrero", "Маrzo", "Аbril", "Mayo", "Junio", "Julio", "Аgosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"], day_for_recurring: ["Domingo", "Lunes", "Martes", "Miércoles", "Jeuves", "Viernes", "Sabado"] } }, fi = { date: { month_full: ["Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kes&auml;kuu", "Hein&auml;kuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"], month_short: ["Tam", "Hel", "Maa", "Huh", "Tou", "Kes", "Hei", "Elo", "Syy", "Lok", "Mar", "Jou"], day_full: ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"], day_short: ["Su", "Ma", "Ti", "Ke", "To", "Pe", "La"] }, labels: { dhx_cal_today_button: "Tänään", day_tab: "Päivä", week_tab: "Viikko", month_tab: "Kuukausi", new_event: "Uusi tapahtuma", icon_save: "Tallenna", icon_cancel: "Peru", icon_details: "Tiedot", icon_edit: "Muokkaa", icon_delete: "Poista", confirm_closing: "", confirm_deleting: "Haluatko varmasti poistaa tapahtuman?", section_description: "Kuvaus", section_time: "Aikajakso", full_day: "Koko päivä", confirm_recurring: "Haluatko varmasti muokata toistuvan tapahtuman kaikkia jaksoja?", section_recurring: "Toista tapahtuma", button_recurring: "Ei k&auml;yt&ouml;ss&auml;", button_recurring_open: "K&auml;yt&ouml;ss&auml;", button_edit_series: "Muokkaa sarja", button_edit_occurrence: "Muokkaa kopio", agenda_tab: "Esityslista", date: "Päivämäärä", description: "Kuvaus", year_tab: "Vuoden", week_agenda_tab: "Esityslista", grid_tab: "Ritilä", drag_to_create: "Luo uusi vetämällä", drag_to_move: "Siirrä vetämällä", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "P&auml;ivitt&auml;in", repeat_radio_week: "Viikoittain", repeat_radio_month: "Kuukausittain", repeat_radio_year: "Vuosittain", repeat_radio_day_type: "Joka", repeat_text_day_count: "p&auml;iv&auml;", repeat_radio_day_type2: "Joka arkip&auml;iv&auml;", repeat_week: "Toista joka", repeat_text_week_count: "viikko n&auml;in&auml; p&auml;ivin&auml;:", repeat_radio_month_type: "Toista", repeat_radio_month_start: "", repeat_text_month_day: "p&auml;iv&auml;n&auml; joka", repeat_text_month_count: "kuukausi", repeat_text_month_count2_before: "joka", repeat_text_month_count2_after: "kuukausi", repeat_year_label: "", select_year_day2: "", repeat_text_year_day: "p&auml;iv&auml;", select_year_month: "kuukausi", repeat_radio_end: "Ei loppumisaikaa", repeat_text_occurences_count: "Toiston j&auml;lkeen", repeat_radio_end3: "Loppuu", repeat_radio_end2: "", month_for_recurring: ["Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kes&auml;kuu", "Hein&auml;kuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"], day_for_recurring: ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"] } }, fr = { date: { month_full: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"], month_short: ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"], day_full: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"], day_short: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"] }, labels: { dhx_cal_today_button: "Aujourd'hui", day_tab: "Jour", week_tab: "Semaine", month_tab: "Mois", new_event: "Nouvel événement", icon_save: "Enregistrer", icon_cancel: "Annuler", icon_details: "Détails", icon_edit: "Modifier", icon_delete: "Effacer", confirm_closing: "", confirm_deleting: "L'événement sera effacé sans appel, êtes-vous sûr ?", section_description: "Description", section_time: "Période", full_day: "Journée complète", confirm_recurring: "Voulez-vous éditer toute une série d'évènements répétés?", section_recurring: "Périodicité", button_recurring: "Désactivé", button_recurring_open: "Activé", button_edit_series: "Modifier la série", button_edit_occurrence: "Modifier une copie", agenda_tab: "Jour", date: "Date", description: "Description", year_tab: "Année", week_agenda_tab: "Jour", grid_tab: "Grille", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Quotidienne", repeat_radio_week: "Hebdomadaire", repeat_radio_month: "Mensuelle", repeat_radio_year: "Annuelle", repeat_radio_day_type: "Chaque", repeat_text_day_count: "jour", repeat_radio_day_type2: "Chaque journée de travail", repeat_week: " Répéter toutes les", repeat_text_week_count: "semaine:", repeat_radio_month_type: "Répéter", repeat_radio_month_start: "Le", repeat_text_month_day: "jour chaque", repeat_text_month_count: "mois", repeat_text_month_count2_before: "chaque", repeat_text_month_count2_after: "mois", repeat_year_label: "Le", select_year_day2: "du", repeat_text_year_day: "jour", select_year_month: "mois", repeat_radio_end: "Pas de date d&quot;achèvement", repeat_text_occurences_count: "occurrences", repeat_radio_end3: "Fin", repeat_radio_end2: "Après", month_for_recurring: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"], day_for_recurring: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] } }, he = { date: { month_full: ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"], month_short: ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"], day_full: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"], day_short: ["א", "ב", "ג", "ד", "ה", "ו", "ש"] }, labels: { dhx_cal_today_button: "היום", day_tab: "יום", week_tab: "שבוע", month_tab: "חודש", new_event: "ארוע חדש", icon_save: "שמור", icon_cancel: "בטל", icon_details: "פרטים", icon_edit: "ערוך", icon_delete: "מחק", confirm_closing: "", confirm_deleting: "ארוע ימחק סופית.להמשיך?", section_description: "תיאור", section_time: "תקופה", confirm_recurring: "האם ברצונך לשנות כל סדרת ארועים מתמשכים?", section_recurring: "להעתיק ארוע", button_recurring: "לא פעיל", button_recurring_open: "פעיל", full_day: "יום שלם", button_edit_series: "ערוך את הסדרה", button_edit_occurrence: "עריכת עותק", agenda_tab: "סדר יום", date: "תאריך", description: "תיאור", year_tab: "לשנה", week_agenda_tab: "סדר יום", grid_tab: "סורג", drag_to_create: "Drag to create", drag_to_move: "גרור כדי להזיז", message_ok: "OK", message_cancel: "בטל", next: "הבא", prev: "הקודם", year: "שנה", month: "חודש", day: "יום", hour: "שעה", minute: "דקה", repeat_radio_day: "יומי", repeat_radio_week: "שבועי", repeat_radio_month: "חודשי", repeat_radio_year: "שנתי", repeat_radio_day_type: "חזור כל", repeat_text_day_count: "ימים", repeat_radio_day_type2: "חזור כל יום עבודה", repeat_week: " חזור כל", repeat_text_week_count: "שבוע לפי ימים:", repeat_radio_month_type: "חזור כל", repeat_radio_month_start: "כל", repeat_text_month_day: "ימים כל", repeat_text_month_count: "חודשים", repeat_text_month_count2_before: "חזור כל", repeat_text_month_count2_after: "חודש", repeat_year_label: "כל", select_year_day2: "בחודש", repeat_text_year_day: "ימים", select_year_month: "חודש", repeat_radio_end: "לעולם לא מסתיים", repeat_text_occurences_count: "אירועים", repeat_radio_end3: "מסתיים ב", repeat_radio_end2: "אחרי", month_for_recurring: ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"], day_for_recurring: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] } }, hu = { date: { month_full: ["Január", "Február", "Március", "Április", "Május", "Június", "Július", "Augusztus", "Szeptember", "Október", "November", "December"], month_short: ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Sep", "Okt", "Nov", "Dec"], day_full: ["Vasárnap", "Hétfõ", "Kedd", "Szerda", "Csütörtök", "Péntek", "szombat"], day_short: ["Va", "Hé", "Ke", "Sze", "Csü", "Pé", "Szo"] }, labels: { dhx_cal_today_button: "Ma", day_tab: "Nap", week_tab: "Hét", month_tab: "Hónap", new_event: "Új esemény", icon_save: "Mentés", icon_cancel: "Mégse", icon_details: "Részletek", icon_edit: "Szerkesztés", icon_delete: "Törlés", confirm_closing: "", confirm_deleting: "Az esemény törölve lesz, biztosan folytatja?", section_description: "Leírás", section_time: "Idõszak", full_day: "Egesz napos", confirm_recurring: "Biztosan szerkeszteni akarod az összes ismétlõdõ esemény beállítását?", section_recurring: "Esemény ismétlése", button_recurring: "Tiltás", button_recurring_open: "Engedélyezés", button_edit_series: "Edit series", button_edit_occurrence: "Szerkesztés bíróság", agenda_tab: "Napirend", date: "Dátum", description: "Leírás", year_tab: "Év", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, id = { date: { month_full: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"], month_short: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"], day_full: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"], day_short: ["Ming", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] }, labels: { dhx_cal_today_button: "Hari Ini", day_tab: "Hari", week_tab: "Minggu", month_tab: "Bulan", new_event: "Acara Baru", icon_save: "Simpan", icon_cancel: "Batal", icon_details: "Detail", icon_edit: "Edit", icon_delete: "Hapus", confirm_closing: "", confirm_deleting: "Acara akan dihapus", section_description: "Keterangan", section_time: "Periode", full_day: "Hari penuh", confirm_recurring: "Apakah acara ini akan berulang?", section_recurring: "Acara Rutin", button_recurring: "Tidak Difungsikan", button_recurring_open: "Difungsikan", button_edit_series: "Mengedit seri", button_edit_occurrence: "Mengedit salinan", agenda_tab: "Agenda", date: "Tanggal", description: "Keterangan", year_tab: "Tahun", week_agenda_tab: "Agenda", grid_tab: "Tabel", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, it = { date: { month_full: ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"], month_short: ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"], day_full: ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"], day_short: ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] }, labels: { dhx_cal_today_button: "Oggi", day_tab: "Giorno", week_tab: "Settimana", month_tab: "Mese", new_event: "Nuovo evento", icon_save: "Salva", icon_cancel: "Chiudi", icon_details: "Dettagli", icon_edit: "Modifica", icon_delete: "Elimina", confirm_closing: "", confirm_deleting: "L'evento sarà eliminato, siete sicuri?", section_description: "Descrizione", section_time: "Periodo di tempo", full_day: "Intera giornata", confirm_recurring: "Vuoi modificare l'intera serie di eventi?", section_recurring: "Ripetere l'evento", button_recurring: "Disattivato", button_recurring_open: "Attivato", button_edit_series: "Modificare la serie", button_edit_occurrence: "Modificare una copia", agenda_tab: "Agenda", date: "Data", description: "Descrizione", year_tab: "Anno", week_agenda_tab: "Agenda", grid_tab: "Griglia", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Quotidiano", repeat_radio_week: "Settimanale", repeat_radio_month: "Mensile", repeat_radio_year: "Annuale", repeat_radio_day_type: "Ogni", repeat_text_day_count: "giorno", repeat_radio_day_type2: "Ogni giornata lavorativa", repeat_week: " Ripetere ogni", repeat_text_week_count: "settimana:", repeat_radio_month_type: "Ripetere", repeat_radio_month_start: "Il", repeat_text_month_day: "giorno ogni", repeat_text_month_count: "mese", repeat_text_month_count2_before: "ogni", repeat_text_month_count2_after: "mese", repeat_year_label: "Il", select_year_day2: "del", repeat_text_year_day: "giorno", select_year_month: "mese", repeat_radio_end: "Senza data finale", repeat_text_occurences_count: "occorenze", repeat_radio_end3: "Fine", repeat_radio_end2: "Dopo", month_for_recurring: ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Jiugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"], day_for_recurring: ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Jovedì", "Venerdì", "Sabato"] } }, jp = { date: { month_full: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"], month_short: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"], day_full: ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"], day_short: ["日", "月", "火", "水", "木", "金", "土"] }, labels: { dhx_cal_today_button: "今日", day_tab: "日", week_tab: "週", month_tab: "月", new_event: "新イベント", icon_save: "保存", icon_cancel: "キャンセル", icon_details: "詳細", icon_edit: "編集", icon_delete: "削除", confirm_closing: "", confirm_deleting: "イベント完全に削除されます、宜しいですか？", section_description: "デスクリプション", section_time: "期間", confirm_recurring: "繰り返されているイベントを全て編集しますか？", section_recurring: "イベントを繰り返す", button_recurring: "無効", button_recurring_open: "有効", full_day: "終日", button_edit_series: "シリーズを編集します", button_edit_occurrence: "コピーを編集", agenda_tab: "議題は", date: "日付", description: "説明", year_tab: "今年", week_agenda_tab: "議題は", grid_tab: "グリッド", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } };
    class LocaleManager {
      constructor(a) {
        this._locales = {};
        for (const t in a)
          this._locales[t] = a[t];
      }
      addLocale(a, t) {
        this._locales[a] = t;
      }
      getLocale(a) {
        return this._locales[a];
      }
    }
    const nb = { date: { month_full: ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"], month_short: ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"], day_full: ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"], day_short: ["Søn", "Mon", "Tir", "Ons", "Tor", "Fre", "Lør"] }, labels: { dhx_cal_today_button: "I dag", day_tab: "Dag", week_tab: "Uke", month_tab: "Måned", new_event: "Ny hendelse", icon_save: "Lagre", icon_cancel: "Avbryt", icon_details: "Detaljer", icon_edit: "Rediger", icon_delete: "Slett", confirm_closing: "", confirm_deleting: "Hendelsen vil bli slettet permanent. Er du sikker?", section_description: "Beskrivelse", section_time: "Tidsperiode", confirm_recurring: "Vil du forandre hele dette settet av repeterende hendelser?", section_recurring: "Repeter hendelsen", button_recurring: "Av", button_recurring_open: "På", button_edit_series: "Rediger serien", button_edit_occurrence: "Redigere en kopi", agenda_tab: "Agenda", date: "Dato", description: "Beskrivelse", year_tab: "År", week_agenda_tab: "Agenda", grid_tab: "Grid", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Daglig", repeat_radio_week: "Ukentlig", repeat_radio_month: "Månedlig", repeat_radio_year: "Årlig", repeat_radio_day_type: "Hver", repeat_text_day_count: "dag", repeat_radio_day_type2: "Alle hverdager", repeat_week: " Gjentas hver", repeat_text_week_count: "uke på:", repeat_radio_month_type: "På hver", repeat_radio_month_start: "På", repeat_text_month_day: "dag hver", repeat_text_month_count: "måned", repeat_text_month_count2_before: "hver", repeat_text_month_count2_after: "måned", repeat_year_label: "på", select_year_day2: "i", repeat_text_year_day: "dag i", select_year_month: "", repeat_radio_end: "Ingen sluttdato", repeat_text_occurences_count: "forekomst", repeat_radio_end3: "Stop den", repeat_radio_end2: "Etter", month_for_recurring: ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"], day_for_recurring: ["Sondag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"] } }, nl = { date: { month_full: ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"], month_short: ["Jan", "Feb", "mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"], day_full: ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"], day_short: ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"] }, labels: { dhx_cal_today_button: "Vandaag", day_tab: "Dag", week_tab: "Week", month_tab: "Maand", new_event: "Nieuw item", icon_save: "Opslaan", icon_cancel: "Annuleren", icon_details: "Details", icon_edit: "Bewerken", icon_delete: "Verwijderen", confirm_closing: "", confirm_deleting: "Item zal permanent worden verwijderd, doorgaan?", section_description: "Beschrijving", section_time: "Tijd periode", full_day: "Hele dag", confirm_recurring: "Wilt u alle terugkerende items bijwerken?", section_recurring: "Item herhalen", button_recurring: "Uit", button_recurring_open: "Aan", button_edit_series: "Bewerk de serie", button_edit_occurrence: "Bewerk een kopie", agenda_tab: "Agenda", date: "Datum", description: "Omschrijving", year_tab: "Jaar", week_agenda_tab: "Agenda", grid_tab: "Tabel", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Dagelijks", repeat_radio_week: "Wekelijks", repeat_radio_month: "Maandelijks", repeat_radio_year: "Jaarlijks", repeat_radio_day_type: "Elke", repeat_text_day_count: "dag(en)", repeat_radio_day_type2: "Elke werkdag", repeat_week: " Herhaal elke", repeat_text_week_count: "week op de volgende dagen:", repeat_radio_month_type: "Herhaal", repeat_radio_month_start: "Op", repeat_text_month_day: "dag iedere", repeat_text_month_count: "maanden", repeat_text_month_count2_before: "iedere", repeat_text_month_count2_after: "maanden", repeat_year_label: "Op", select_year_day2: "van", repeat_text_year_day: "dag", select_year_month: "maand", repeat_radio_end: "Geen eind datum", repeat_text_occurences_count: "keren", repeat_radio_end3: "Eindigd per", repeat_radio_end2: "Na", month_for_recurring: ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"], day_for_recurring: ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"] } }, no = { date: { month_full: ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"], month_short: ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"], day_full: ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"], day_short: ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"] }, labels: { dhx_cal_today_button: "Idag", day_tab: "Dag", week_tab: "Uke", month_tab: "Måned", new_event: "Ny", icon_save: "Lagre", icon_cancel: "Avbryt", icon_details: "Detaljer", icon_edit: "Endre", icon_delete: "Slett", confirm_closing: "Endringer blir ikke lagret, er du sikker?", confirm_deleting: "Oppføringen vil bli slettet, er du sikker?", section_description: "Beskrivelse", section_time: "Tidsperiode", full_day: "Full dag", confirm_recurring: "Vil du endre hele settet med repeterende oppføringer?", section_recurring: "Repeterende oppføring", button_recurring: "Ikke aktiv", button_recurring_open: "Aktiv", button_edit_series: "Rediger serien", button_edit_occurrence: "Redigere en kopi", agenda_tab: "Agenda", date: "Dato", description: "Beskrivelse", year_tab: "År", week_agenda_tab: "Agenda", grid_tab: "Grid", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, pl = { date: { month_full: ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"], month_short: ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"], day_full: ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"], day_short: ["Nie", "Pon", "Wto", "Śro", "Czw", "Pią", "Sob"] }, labels: { dhx_cal_today_button: "Dziś", day_tab: "Dzień", week_tab: "Tydzień", month_tab: "Miesiąc", new_event: "Nowe zdarzenie", icon_save: "Zapisz", icon_cancel: "Anuluj", icon_details: "Szczegóły", icon_edit: "Edytuj", icon_delete: "Usuń", confirm_closing: "", confirm_deleting: "Zdarzenie zostanie usunięte na zawsze, kontynuować?", section_description: "Opis", section_time: "Okres czasu", full_day: "Cały dzień", confirm_recurring: "Czy chcesz edytować cały zbiór powtarzających się zdarzeń?", section_recurring: "Powtórz zdarzenie", button_recurring: "Nieaktywne", button_recurring_open: "Aktywne", button_edit_series: "Edytuj serię", button_edit_occurrence: "Edytuj kopię", agenda_tab: "Agenda", date: "Data", description: "Opis", year_tab: "Rok", week_agenda_tab: "Agenda", grid_tab: "Tabela", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Codziennie", repeat_radio_week: "Co tydzie", repeat_radio_month: "Co miesic", repeat_radio_year: "Co rok", repeat_radio_day_type: "Kadego", repeat_text_day_count: "dnia", repeat_radio_day_type2: "Kadego dnia roboczego", repeat_week: " Powtarzaj kadego", repeat_text_week_count: "tygodnia w dni:", repeat_radio_month_type: "Powtrz", repeat_radio_month_start: "W", repeat_text_month_day: "dnia kadego", repeat_text_month_count: "miesica", repeat_text_month_count2_before: "kadego", repeat_text_month_count2_after: "miesica", repeat_year_label: "W", select_year_day2: "miesica", repeat_text_year_day: "dnia miesica", select_year_month: "", repeat_radio_end: "Bez daty kocowej", repeat_text_occurences_count: "wystpieniu/ach", repeat_radio_end3: "Zakocz w", repeat_radio_end2: "Po", month_for_recurring: ["Stycznia", "Lutego", "Marca", "Kwietnia", "Maja", "Czerwca", "Lipca", "Sierpnia", "Wrzenia", "Padziernka", "Listopada", "Grudnia"], day_for_recurring: ["Niedziela", "Poniedziaek", "Wtorek", "roda", "Czwartek", "Pitek", "Sobota"] } }, pt = { date: { month_full: ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"], month_short: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"], day_full: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], day_short: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"] }, labels: { dhx_cal_today_button: "Hoje", day_tab: "Dia", week_tab: "Semana", month_tab: "Mês", new_event: "Novo evento", icon_save: "Salvar", icon_cancel: "Cancelar", icon_details: "Detalhes", icon_edit: "Editar", icon_delete: "Deletar", confirm_closing: "", confirm_deleting: "Tem certeza que deseja excluir?", section_description: "Descrição", section_time: "Período de tempo", full_day: "Dia inteiro", confirm_recurring: "Deseja editar todos esses eventos repetidos?", section_recurring: "Repetir evento", button_recurring: "Desabilitar", button_recurring_open: "Habilitar", button_edit_series: "Editar a série", button_edit_occurrence: "Editar uma cópia", agenda_tab: "Dia", date: "Data", description: "Descrição", year_tab: "Ano", week_agenda_tab: "Dia", grid_tab: "Grade", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Diário", repeat_radio_week: "Semanal", repeat_radio_month: "Mensal", repeat_radio_year: "Anual", repeat_radio_day_type: "Cada", repeat_text_day_count: "dia(s)", repeat_radio_day_type2: "Cada trabalho diário", repeat_week: " Repita cada", repeat_text_week_count: "semana:", repeat_radio_month_type: "Repetir", repeat_radio_month_start: "Em", repeat_text_month_day: "todo dia", repeat_text_month_count: "mês", repeat_text_month_count2_before: "todo", repeat_text_month_count2_after: "mês", repeat_year_label: "Em", select_year_day2: "of", repeat_text_year_day: "dia", select_year_month: "mês", repeat_radio_end: "Sem data final", repeat_text_occurences_count: "ocorrências", repeat_radio_end3: "Fim", repeat_radio_end2: "Depois", month_for_recurring: ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"], day_for_recurring: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] } }, ro = { date: { month_full: ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "November", "December"], month_short: ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Nov", "Dec"], day_full: ["Duminica", "Luni", "Marti", "Miercuri", "Joi", "Vineri", "Sambata"], day_short: ["Du", "Lu", "Ma", "Mi", "Jo", "Vi", "Sa"] }, labels: { dhx_cal_today_button: "Astazi", day_tab: "Zi", week_tab: "Saptamana", month_tab: "Luna", new_event: "Eveniment nou", icon_save: "Salveaza", icon_cancel: "Anuleaza", icon_details: "Detalii", icon_edit: "Editeaza", icon_delete: "Sterge", confirm_closing: "Schimbarile nu vor fi salvate, esti sigur?", confirm_deleting: "Evenimentul va fi sters permanent, esti sigur?", section_description: "Descriere", section_time: "Interval", full_day: "Toata ziua", confirm_recurring: "Vrei sa editezi toata seria de evenimente repetate?", section_recurring: "Repetare", button_recurring: "Dezactivata", button_recurring_open: "Activata", button_edit_series: "Editeaza serie", button_edit_occurrence: "Editeaza doar intrare", agenda_tab: "Agenda", date: "Data", description: "Descriere", year_tab: "An", week_agenda_tab: "Agenda", grid_tab: "Lista", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Zilnic", repeat_radio_week: "Saptamanal", repeat_radio_month: "Lunar", repeat_radio_year: "Anual", repeat_radio_day_type: "La fiecare", repeat_text_day_count: "zi(le)", repeat_radio_day_type2: "Fiecare zi lucratoare", repeat_week: " Repeta la fiecare", repeat_text_week_count: "saptamana in urmatoarele zile:", repeat_radio_month_type: "Repeta in", repeat_radio_month_start: "In a", repeat_text_month_day: "zi la fiecare", repeat_text_month_count: "luni", repeat_text_month_count2_before: "la fiecare", repeat_text_month_count2_after: "luni", repeat_year_label: "In", select_year_day2: "a lunii", repeat_text_year_day: "zi a lunii", select_year_month: "", repeat_radio_end: "Fara data de sfarsit", repeat_text_occurences_count: "evenimente", repeat_radio_end3: "La data", repeat_radio_end2: "Dupa", month_for_recurring: ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"], day_for_recurring: ["Duminica", "Luni", "Marti", "Miercuri", "Joi", "Vineri", "Sambata"] } }, ru = { date: { month_full: ["Январь", "Февраль", "Март", "Апрель", "Maй", "Июнь", "Июль", "Август", "Сентябрь", "Oктябрь", "Ноябрь", "Декабрь"], month_short: ["Янв", "Фев", "Maр", "Aпр", "Maй", "Июн", "Июл", "Aвг", "Сен", "Окт", "Ноя", "Дек"], day_full: ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"], day_short: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] }, labels: { dhx_cal_today_button: "Сегодня", day_tab: "День", week_tab: "Неделя", month_tab: "Месяц", new_event: "Новое событие", icon_save: "Сохранить", icon_cancel: "Отменить", icon_details: "Детали", icon_edit: "Изменить", icon_delete: "Удалить", confirm_closing: "", confirm_deleting: "Событие будет удалено безвозвратно, продолжить?", section_description: "Описание", section_time: "Период времени", full_day: "Весь день", confirm_recurring: "Вы хотите изменить всю серию повторяющихся событий?", section_recurring: "Повторение", button_recurring: "Отключено", button_recurring_open: "Включено", button_edit_series: "Редактировать серию", button_edit_occurrence: "Редактировать экземпляр", agenda_tab: "Список", date: "Дата", description: "Описание", year_tab: "Год", week_agenda_tab: "Список", grid_tab: "Таблица", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "День", repeat_radio_week: "Неделя", repeat_radio_month: "Месяц", repeat_radio_year: "Год", repeat_radio_day_type: "Каждый", repeat_text_day_count: "день", repeat_radio_day_type2: "Каждый рабочий день", repeat_week: " Повторять каждую", repeat_text_week_count: "неделю , в:", repeat_radio_month_type: "Повторять", repeat_radio_month_start: "", repeat_text_month_day: " числа каждый ", repeat_text_month_count: "месяц", repeat_text_month_count2_before: "каждый ", repeat_text_month_count2_after: "месяц", repeat_year_label: "", select_year_day2: "", repeat_text_year_day: "день", select_year_month: "", repeat_radio_end: "Без даты окончания", repeat_text_occurences_count: "повторений", repeat_radio_end3: "До ", repeat_radio_end2: "", month_for_recurring: ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"], day_for_recurring: ["Воскресенье", "Понедельник", "Вторник", "Среду", "Четверг", "Пятницу", "Субботу"] } }, si = { date: { month_full: ["Januar", "Februar", "Marec", "April", "Maj", "Junij", "Julij", "Avgust", "September", "Oktober", "November", "December"], month_short: ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"], day_full: ["Nedelja", "Ponedeljek", "Torek", "Sreda", "Četrtek", "Petek", "Sobota"], day_short: ["Ned", "Pon", "Tor", "Sre", "Čet", "Pet", "Sob"] }, labels: { dhx_cal_today_button: "Danes", day_tab: "Dan", week_tab: "Teden", month_tab: "Mesec", new_event: "Nov dogodek", icon_save: "Shrani", icon_cancel: "Prekliči", icon_details: "Podrobnosti", icon_edit: "Uredi", icon_delete: "Izbriši", confirm_closing: "", confirm_deleting: "Dogodek bo izbrisan. Želite nadaljevati?", section_description: "Opis", section_time: "Časovni okvir", full_day: "Ves dan", confirm_recurring: "Želite urediti celoten set ponavljajočih dogodkov?", section_recurring: "Ponovi dogodek", button_recurring: "Onemogočeno", button_recurring_open: "Omogočeno", button_edit_series: "Edit series", button_edit_occurrence: "Edit occurrence", agenda_tab: "Zadeva", date: "Datum", description: "Opis", year_tab: "Leto", week_agenda_tab: "Zadeva", grid_tab: "Miza", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, sk = { date: { month_full: ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"], month_short: ["Jan", "Feb", "Mar", "Apr", "Máj", "Jún", "Júl", "Aug", "Sept", "Okt", "Nov", "Dec"], day_full: ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"], day_short: ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"] }, labels: { dhx_cal_today_button: "Dnes", day_tab: "Deň", week_tab: "Týždeň", month_tab: "Mesiac", new_event: "Nová udalosť", icon_save: "Uložiť", icon_cancel: "Späť", icon_details: "Detail", icon_edit: "Edituj", icon_delete: "Zmazať", confirm_closing: "Vaše zmeny nebudú uložené. Skutočne?", confirm_deleting: "Udalosť bude natrvalo vymazaná. Skutočne?", section_description: "Poznámky", section_time: "Doba platnosti", confirm_recurring: "Prajete si upraviť celú radu opakovaných udalostí?", section_recurring: "Opakovanie udalosti", button_recurring: "Vypnuté", button_recurring_open: "Zapnuté", button_edit_series: "Upraviť opakovania", button_edit_occurrence: "Upraviť inštancie", agenda_tab: "Program", date: "Dátum", description: "Poznámka", year_tab: "Rok", full_day: "Celý deň", week_agenda_tab: "Program", grid_tab: "Mriežka", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Denne", repeat_radio_week: "Týždenne", repeat_radio_month: "Mesaène", repeat_radio_year: "Roène", repeat_radio_day_type: "Každý", repeat_text_day_count: "deò", repeat_radio_day_type2: "Každý prac. deò", repeat_week: "Opakova každý", repeat_text_week_count: "týždeò v dòoch:", repeat_radio_month_type: "Opakova", repeat_radio_month_start: "On", repeat_text_month_day: "deò každý", repeat_text_month_count: "mesiac", repeat_text_month_count2_before: "každý", repeat_text_month_count2_after: "mesiac", repeat_year_label: "On", select_year_day2: "poèas", repeat_text_year_day: "deò", select_year_month: "mesiac", repeat_radio_end: "Bez dátumu ukonèenia", repeat_text_occurences_count: "udalostiach", repeat_radio_end3: "Ukonèi", repeat_radio_end2: "Po", month_for_recurring: ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"], day_for_recurring: ["Nede¾a", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"] } }, sv = { date: { month_full: ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"], month_short: ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"], day_full: ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"], day_short: ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"] }, labels: { dhx_cal_today_button: "Idag", day_tab: "Dag", week_tab: "Vecka", month_tab: "Månad", new_event: "Ny händelse", icon_save: "Spara", icon_cancel: "Ångra", icon_details: "Detaljer", icon_edit: "Ändra", icon_delete: "Ta bort", confirm_closing: "", confirm_deleting: "Är du säker på att du vill ta bort händelsen permanent?", section_description: "Beskrivning", section_time: "Tid", full_day: "Hela dagen", confirm_recurring: "Vill du redigera hela serien med repeterande händelser?", section_recurring: "Upprepa händelse", button_recurring: "Inaktiverat", button_recurring_open: "Aktiverat", button_edit_series: "Redigera serien", button_edit_occurrence: "Redigera en kopia", agenda_tab: "Dagordning", date: "Datum", description: "Beskrivning", year_tab: "År", week_agenda_tab: "Dagordning", grid_tab: "Galler", drag_to_create: "Dra för att skapa ny", drag_to_move: "Dra för att flytta", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "Dagligen", repeat_radio_week: "Veckovis", repeat_radio_month: "Månadsvis", repeat_radio_year: "Årligen", repeat_radio_day_type: "Var", repeat_text_day_count: "dag", repeat_radio_day_type2: "Varje arbetsdag", repeat_week: " Upprepa var", repeat_text_week_count: "vecka dessa dagar:", repeat_radio_month_type: "Upprepa", repeat_radio_month_start: "Den", repeat_text_month_day: "dagen var", repeat_text_month_count: "månad", repeat_text_month_count2_before: "var", repeat_text_month_count2_after: "månad", repeat_year_label: "Den", select_year_day2: "i", repeat_text_year_day: "dag i", select_year_month: "månad", repeat_radio_end: "Inget slutdatum", repeat_text_occurences_count: "upprepningar", repeat_radio_end3: "Sluta efter", repeat_radio_end2: "Efter", month_for_recurring: ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"], day_for_recurring: ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"] } }, tr = { date: { month_full: ["Ocak", "Þubat", "Mart", "Nisan", "Mayýs", "Haziran", "Temmuz", "Aðustos", "Eylül", "Ekim", "Kasým", "Aralýk"], month_short: ["Oca", "Þub", "Mar", "Nis", "May", "Haz", "Tem", "Aðu", "Eyl", "Eki", "Kas", "Ara"], day_full: ["Pazar", "Pazartes,", "Salý", "Çarþamba", "Perþembe", "Cuma", "Cumartesi"], day_short: ["Paz", "Pts", "Sal", "Çar", "Per", "Cum", "Cts"] }, labels: { dhx_cal_today_button: "Bugün", day_tab: "Gün", week_tab: "Hafta", month_tab: "Ay", new_event: "Uygun", icon_save: "Kaydet", icon_cancel: "Ýptal", icon_details: "Detaylar", icon_edit: "Düzenle", icon_delete: "Sil", confirm_closing: "", confirm_deleting: "Etkinlik silinecek, devam?", section_description: "Açýklama", section_time: "Zaman aralýðý", full_day: "Tam gün", confirm_recurring: "Tüm tekrar eden etkinlikler silinecek, devam?", section_recurring: "Etkinliði tekrarla", button_recurring: "Pasif", button_recurring_open: "Aktif", button_edit_series: "Dizi düzenleme", button_edit_occurrence: "Bir kopyasını düzenleyin", agenda_tab: "Ajanda", date: "Tarih", description: "Açýklama", year_tab: "Yýl", week_agenda_tab: "Ajanda", grid_tab: "Izgara", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute" } }, ua = { date: { month_full: ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"], month_short: ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"], day_full: ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"], day_short: ["Нед", "Пон", "Вів", "Сер", "Чет", "Птн", "Суб"] }, labels: { dhx_cal_today_button: "Сьогодні", day_tab: "День", week_tab: "Тиждень", month_tab: "Місяць", new_event: "Нова подія", icon_save: "Зберегти", icon_cancel: "Відміна", icon_details: "Деталі", icon_edit: "Редагувати", icon_delete: "Вилучити", confirm_closing: "", confirm_deleting: "Подія вилучиться назавжди. Ви впевнені?", section_description: "Опис", section_time: "Часовий проміжок", full_day: "Весь день", confirm_recurring: "Хочете редагувати весь перелік повторюваних подій?", section_recurring: "Повторювана подія", button_recurring: "Відключено", button_recurring_open: "Включено", button_edit_series: "Редагувати серію", button_edit_occurrence: "Редагувати примірник", agenda_tab: "Перелік", date: "Дата", description: "Опис", year_tab: "Рік", week_agenda_tab: "Перелік", grid_tab: "Таблиця", drag_to_create: "Drag to create", drag_to_move: "Drag to move", message_ok: "OK", message_cancel: "Cancel", next: "Next", prev: "Previous", year: "Year", month: "Month", day: "Day", hour: "Hour", minute: "Minute", repeat_radio_day: "День", repeat_radio_week: "Тиждень", repeat_radio_month: "Місяць", repeat_radio_year: "Рік", repeat_radio_day_type: "Кожний", repeat_text_day_count: "день", repeat_radio_day_type2: "Кожний робочий день", repeat_week: " Повторювати кожен", repeat_text_week_count: "тиждень , по:", repeat_radio_month_type: "Повторювати", repeat_radio_month_start: "", repeat_text_month_day: " числа кожний ", repeat_text_month_count: "місяць", repeat_text_month_count2_before: "кожен ", repeat_text_month_count2_after: "місяць", repeat_year_label: "", select_year_day2: "", repeat_text_year_day: "день", select_year_month: "", repeat_radio_end: "Без дати закінчення", repeat_text_occurences_count: "повторень", repeat_radio_end3: "До ", repeat_radio_end2: "", month_for_recurring: ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"], day_for_recurring: ["Неділям", "Понеділкам", "Вівторкам", "Середам", "Четвергам", "П'ятницям", "Суботам"] } };
    function i18nFactory() {
      return new LocaleManager({ en, ar, be, ca, cn, cs, da, de, el, es, fi, fr, he, hu, id, it, jp, nb, nl, no, pl, pt, ro, ru, si, sk, sv, tr, ua });
    }
    class DatePicker {
      constructor(a, t, n = {}) {
        this.state = { date: /* @__PURE__ */ new Date(), modes: ["days", "months", "years"], currentRange: [], eventDates: [], currentModeIndex: 0, ...n }, this.container = null, this.element = null, this.onStateChangeHandlers = [], this.scheduler = a, this._domEvents = a._createDomEventScope(), this.state = this.getState(), makeEventable(this), t && (this.container = t, this.render(this.container)), this.onStateChange((o, r) => {
          this.callEvent("onStateChange", [r, o]);
        });
      }
      getState() {
        return { ...this.state, mode: this.state.modes[this.state.currentModeIndex] };
      }
      setState(a) {
        const t = { ...this.state };
        a.mode && (a.currentModeIndex = this.state.modes.indexOf(a.mode)), this.state = { ...this.state, ...a }, this._notifyStateChange(t, this.state), this.container && this.render(this.container);
      }
      onStateChange(a) {
        return this.onStateChangeHandlers.push(a), () => {
          const t = this.onStateChangeHandlers.indexOf(a);
          t !== -1 && this.onStateChangeHandlers.splice(t, 1);
        };
      }
      _notifyStateChange(a, t) {
        this.onStateChangeHandlers.forEach((n) => n(a, t));
      }
      _adjustDate(a) {
        const { mode: t, date: n } = this.getState(), o = new Date(n);
        t === "days" ? o.setMonth(n.getMonth() + a) : t === "months" ? o.setFullYear(n.getFullYear() + a) : o.setFullYear(n.getFullYear() + 10 * a), this.setState({ date: o });
      }
      _toggleMode() {
        const a = (this.state.currentModeIndex + 1) % this.state.modes.length;
        this.setState({ currentModeIndex: a });
      }
      _renderCalendarHeader(a) {
        const { mode: t, date: n } = this.getState(), o = document.createElement("div");
        o.classList.add("dhx_cal_datepicker_header");
        const r = document.createElement("button");
        r.classList.add("dhx_cal_datepicker_arrow", "scheduler_icon", "arrow_left"), o.appendChild(r);
        const d = document.createElement("div");
        if (d.classList.add("dhx_cal_datepicker_title"), t === "days")
          d.innerText = n.toLocaleString("default", { month: "long" }) + " " + n.getFullYear();
        else if (t === "months")
          d.innerText = n.getFullYear();
        else {
          const s = 10 * Math.floor(n.getFullYear() / 10);
          d.innerText = `${s} - ${s + 9}`;
        }
        this._domEvents.attach(d, "click", this._toggleMode.bind(this)), o.appendChild(d);
        const i = document.createElement("button");
        i.classList.add("dhx_cal_datepicker_arrow", "scheduler_icon", "arrow_right"), o.appendChild(i), a.appendChild(o), this._domEvents.attach(r, "click", this._adjustDate.bind(this, -1)), this._domEvents.attach(i, "click", this._adjustDate.bind(this, 1));
      }
      render(a) {
        this._domEvents.detachAll(), this.container = a || this.container, this.container.innerHTML = "", this.element || (this.element = document.createElement("div"), this.element.classList.add("dhx_cal_datepicker")), this.element.innerHTML = "", this.container.appendChild(this.element), this._renderCalendarHeader(this.element);
        const t = document.createElement("div");
        t.classList.add("dhx_cal_datepicker_data"), this.element.appendChild(t);
        const { mode: n } = this.getState();
        n === "days" ? this._renderDayGrid(t) : n === "months" ? this._renderMonthGrid(t) : this._renderYearGrid(t);
      }
      _renderDayGridHeader(a) {
        const { date: t } = this.getState(), n = this.scheduler;
        let o = n.date.week_start(new Date(t));
        const r = n.date.add(n.date.week_start(new Date(t)), 1, "week");
        a.classList.add("dhx_cal_datepicker_days");
        const d = n.date.date_to_str("%D");
        for (; o.valueOf() < r.valueOf(); ) {
          const i = d(o), s = document.createElement("div");
          s.setAttribute("data-day", o.getDay()), s.classList.add("dhx_cal_datepicker_dayname"), s.innerText = i, a.appendChild(s), o = n.date.add(o, 1, "day");
        }
      }
      _weeksBetween(a, t) {
        const n = this.scheduler;
        let o = 0, r = new Date(a);
        for (; r.valueOf() < t.valueOf(); )
          o += 1, r = n.date.week_start(n.date.add(r, 1, "week"));
        return o;
      }
      _renderDayGrid(a) {
        const { date: t, currentRange: n, eventDates: o, minWeeks: r } = this.getState();
        let d = n[0], i = n[1];
        const s = o.reduce((g, v) => (g[this.scheduler.date.day_start(new Date(v)).valueOf()] = !0, g), {}), _ = document.createElement("div");
        this._renderDayGridHeader(_), a.appendChild(_);
        const l = this.scheduler, h = l.date.week_start(l.date.month_start(new Date(t))), u = l.date.month_start(new Date(t)), m = l.date.add(l.date.month_start(new Date(t)), 1, "month");
        let f = l.date.add(l.date.month_start(new Date(t)), 1, "month");
        f.getDay() !== 0 && (f = l.date.add(l.date.week_start(f), 1, "week"));
        let y = this._weeksBetween(h, f);
        r && y < r && (f = l.date.add(f, r - y, "week"));
        let b = h;
        const c = document.createElement("div");
        for (c.classList.add("dhx_cal_datepicker_days"), this._domEvents.attach(c, "click", (g) => {
          const v = g.target.closest("[data-cell-date]"), p = new Date(v.getAttribute("data-cell-date"));
          this.callEvent("onDateClick", [p, g]);
        }); b.valueOf() < f.valueOf(); ) {
          const g = document.createElement("div");
          g.setAttribute("data-cell-date", l.templates.format_date(b)), g.setAttribute("data-day", b.getDay()), g.innerHTML = b.getDate(), b.valueOf() < u.valueOf() ? g.classList.add("dhx_before") : b.valueOf() >= m.valueOf() && g.classList.add("dhx_after"), b.getDay() !== 0 && b.getDay() !== 6 || g.classList.add("dhx_cal_datepicker_weekend"), d && i && b.valueOf() >= d.valueOf() && b.valueOf() < i.valueOf() && g.classList.add("dhx_cal_datepicker_current"), s[b.valueOf()] && g.classList.add("dhx_cal_datepicker_event"), g.classList.add("dhx_cal_datepicker_date"), c.appendChild(g), b = l.date.add(b, 1, "day");
        }
        a.appendChild(c);
      }
      _renderMonthGrid(a) {
        const { date: t } = this.getState(), n = document.createElement("div");
        n.classList.add("dhx_cal_datepicker_months");
        const o = [];
        for (let s = 0; s < 12; s++)
          o.push(new Date(t.getFullYear(), s, 1));
        const r = this.scheduler.date.date_to_str("%M");
        o.forEach((s) => {
          const _ = document.createElement("div");
          _.classList.add("dhx_cal_datepicker_month"), t.getMonth() === s.getMonth() && _.classList.add("dhx_cal_datepicker_current"), _.setAttribute("data-month", s.getMonth()), _.innerHTML = r(s), this._domEvents.attach(_, "click", () => {
            const l = new Date(s);
            this.setState({ date: l, mode: "days" });
          }), n.appendChild(_);
        }), a.appendChild(n);
        const d = document.createElement("div");
        d.classList.add("dhx_cal_datepicker_done");
        const i = document.createElement("button");
        i.innerText = "Done", i.classList.add("dhx_cal_datepicker_done_btn"), this._domEvents.attach(i, "click", () => {
          this.setState({ mode: "days" });
        }), d.appendChild(i), a.appendChild(d);
      }
      _renderYearGrid(a) {
        const { date: t } = this.getState(), n = 10 * Math.floor(t.getFullYear() / 10), o = document.createElement("div");
        o.classList.add("dhx_cal_datepicker_years");
        for (let i = n - 1; i <= n + 10; i++) {
          const s = document.createElement("div");
          s.innerText = i, s.classList.add("dhx_cal_datepicker_year"), s.setAttribute("data-year", i), t.getFullYear() === i && s.classList.add("dhx_cal_datepicker_current"), this._domEvents.attach(s, "click", () => {
            this.setState({ date: new Date(i, t.getMonth(), 1), mode: "months" });
          }), o.appendChild(s);
        }
        a.appendChild(o);
        const r = document.createElement("div");
        r.classList.add("dhx_cal_datepicker_done");
        const d = document.createElement("button");
        d.innerText = "Done", d.classList.add("dhx_cal_datepicker_done_btn"), this._domEvents.attach(d, "click", () => {
          this.setState({ mode: "months" });
        }), r.appendChild(d), a.appendChild(r);
      }
      destructor() {
        this.onStateChangeHandlers = [], this.element && (this.element.innerHTML = "", this.element.remove()), this._domEvents.detachAll(), this.callEvent("onDestroy", []), this.detachAllEvents(), this.scheduler = null;
      }
    }
    function factoryMethod(e) {
      const a = { version: "7.0.3" };
      extend$p(a), extend$k(a), extend$l(a), extend$j(a), a.utils = utils, a.$domHelpers = dom_helpers, a.utils.dom = dom_helpers, a.uid = utils.uid, a.mixin = utils.mixin, a.defined = utils.defined, a.assert = assert(a), a.copy = utils.copy, a._createDatePicker = function(r, d) {
        return new DatePicker(a, r, d);
      }, a._getFocusableNodes = dom_helpers.getFocusableNodes, a._getClassName = dom_helpers.getClassName, a._locate_css = dom_helpers.locateCss;
      const t = message(a);
      a.utils.mixin(a, t), a.env = a.$env = env, a.Promise = window.Promise, extend$i(a), extend$h(a), extend$g(a), extend$f(a), extend$e(a), extend$d(a), extend$9(a), extend$8(a), extend$7(a), extend$6(a), extend$5(a), extend$4(), extend$3(a), extend$2(a), extend$o(a);
      const n = i18nFactory();
      a.i18n = { addLocale: n.addLocale, setLocale: function(r) {
        if (typeof r == "string") {
          var d = n.getLocale(r);
          d || (d = n.getLocale("en")), a.locale = d;
        } else if (r)
          if (a.locale)
            for (var i in r)
              r[i] && typeof r[i] == "object" ? (a.locale[i] || (a.locale[i] = {}), a.mixin(a.locale[i], r[i], !0)) : a.locale[i] = r[i];
          else
            a.locale = r;
        var s = a.locale.labels;
        s.dhx_save_btn = s.icon_save, s.dhx_cancel_btn = s.icon_cancel, s.dhx_delete_btn = s.icon_delete, a.$container && a.get_elements();
      }, getLocale: n.getLocale }, a.i18n.setLocale("en"), a.ext = {};
      const o = {};
      return a.plugins = function(r) {
        (function(i, s, _) {
          const l = [];
          for (const h in i)
            if (i[h]) {
              const u = h.toLowerCase();
              s[u] && s[u].forEach(function(m) {
                const f = m.toLowerCase();
                i[f] || l.push(f);
              }), l.push(u);
            }
          return l.sort(function(h, u) {
            const m = _[h] || 0, f = _[u] || 0;
            return m > f ? 1 : m < f ? -1 : 0;
          }), l;
        })(r, { treetimeline: ["timeline"], daytimeline: ["timeline"], outerdrag: ["legacy"] }, { legacy: 1, limit: 1, timeline: 2, daytimeline: 3, treetimeline: 3, outerdrag: 6 }).forEach(function(i) {
          if (!o[i]) {
            const s = e.getExtension(i);
            if (!s)
              throw new Error("unknown plugin " + i);
            s(a), o[i] = !0;
          }
        });
      }, a;
    }
    class ExtensionsManager {
      constructor(a) {
        this._extensions = {};
        for (const t in a)
          this._extensions[t] = a[t];
      }
      addExtension(a, t) {
        this._extensions[a] = t;
      }
      getExtension(a) {
        return this._extensions[a];
      }
    }
    dhtmlxHook();
    class SchedulerFactory {
      constructor(a) {
        this._seed = 0, this._schedulerPlugins = [], this._bundledExtensions = a, this._extensionsManager = new ExtensionsManager(a);
      }
      plugin(a) {
        this._schedulerPlugins.push(a), global$1.scheduler && a(global$1.scheduler);
      }
      getSchedulerInstance(a) {
        for (var t = factoryMethod(this._extensionsManager), n = 0; n < this._schedulerPlugins.length; n++)
          this._schedulerPlugins[n](t);
        return t._internal_id = this._seed++, this.$syncFactory && this.$syncFactory(t), a && this._initFromConfig(t, a), t;
      }
      _initFromConfig(a, t) {
        if (t.plugins && a.plugins(t.plugins), t.config && a.mixin(a.config, t.config, !0), t.templates && a.attachEvent("onTemplatesReady", function() {
          a.mixin(a.templates, t.templates, !0);
        }, { once: !0 }), t.events)
          for (const n in t.events)
            a.attachEvent(n, t.events[n]);
        t.locale && a.i18n.setLocale(t.locale), Array.isArray(t.calendars) && t.calendars.forEach(function(n) {
          a.addCalendar(n);
        }), t.container ? a.init(t.container) : a.init(), t.data && (typeof t.data == "string" ? a.load(t.data) : a.parse(t.data));
      }
    }
    function active_links(e) {
      e.config.active_link_view = "day", e._active_link_click = function(a) {
        var t = a.target.getAttribute("data-link-date"), n = e.date.str_to_date(e.config.api_date, !1, !0);
        if (t)
          return e.setCurrentView(n(t), e.config.active_link_view), a && a.preventDefault && a.preventDefault(), !1;
      }, e.attachEvent("onTemplatesReady", function() {
        var a = function(n, o) {
          o = o || n + "_scale_date", e.templates["_active_links_old_" + o] || (e.templates["_active_links_old_" + o] = e.templates[o]);
          var r = e.templates["_active_links_old_" + o], d = e.date.date_to_str(e.config.api_date);
          e.templates[o] = function(i) {
            return "<a data-link-date='" + d(i) + "' href='#'>" + r(i) + "</a>";
          };
        };
        if (a("week"), a("", "month_day"), this.matrix)
          for (var t in this.matrix)
            a(t);
        this._detachDomEvent(this._obj, "click", e._active_link_click), e.event(this._obj, "click", e._active_link_click);
      });
    }
    function agenda_legacy(e) {
      e.date.add_agenda_legacy = function(a) {
        return e.date.add(a, 1, "year");
      }, e.templates.agenda_legacy_time = function(a, t, n) {
        return n._timed ? this.day_date(n.start_date, n.end_date, n) + " " + this.event_date(a) : e.templates.day_date(a) + " &ndash; " + e.templates.day_date(t);
      }, e.templates.agenda_legacy_text = function(a, t, n) {
        return n.text;
      }, e.templates.agenda_legacy_date = function() {
        return "";
      }, e.date.agenda_legacy_start = function() {
        return e.date.date_part(e._currentDate());
      }, e.attachEvent("onTemplatesReady", function() {
        var a = e.dblclick_dhx_cal_data;
        e.dblclick_dhx_cal_data = function() {
          if (this._mode == "agenda_legacy")
            !this.config.readonly && this.config.dblclick_create && this.addEventNow();
          else if (a)
            return a.apply(this, arguments);
        };
        var t = e.render_data;
        e.render_data = function(r) {
          if (this._mode != "agenda_legacy")
            return t.apply(this, arguments);
          o();
        };
        var n = e.render_view_data;
        function o() {
          var r = e.get_visible_events();
          r.sort(function(c, g) {
            return c.start_date > g.start_date ? 1 : -1;
          });
          for (var d, i = "<div class='dhx_agenda_area' " + e._waiAria.agendaDataAttrString() + ">", s = 0; s < r.length; s++) {
            var _ = r[s], l = _.color ? "--dhx-scheduler-event-background:" + _.color + ";" : "", h = _.textColor ? "--dhx-scheduler-event-color:" + _.textColor + ";" : "", u = e.templates.event_class(_.start_date, _.end_date, _);
            d = e._waiAria.agendaEventAttrString(_);
            var m = e._waiAria.agendaDetailsBtnString();
            i += "<div " + d + " class='dhx_agenda_line" + (u ? " " + u : "") + "' event_id='" + _.id + "' " + e.config.event_attribute + "='" + _.id + "' style='" + h + l + (_._text_style || "") + "'><div class='dhx_agenda_event_time'>" + (e.config.rtl ? e.templates.agenda_time(_.end_date, _.start_date, _) : e.templates.agenda_time(_.start_date, _.end_date, _)) + "</div>", i += `<div ${m} class='dhx_event_icon icon_details'><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M15.4444 16.4H4.55556V7.6H15.4444V16.4ZM13.1111 2V3.6H6.88889V2H5.33333V3.6H4.55556C3.69222 3.6 3 4.312 3 5.2V16.4C3 16.8243 3.16389 17.2313 3.45561 17.5314C3.74733 17.8314 4.143 18 4.55556 18H15.4444C15.857 18 16.2527 17.8314 16.5444 17.5314C16.8361 17.2313 17 16.8243 17 16.4V5.2C17 4.312 16.3 3.6 15.4444 3.6H14.6667V2H13.1111ZM13.8889 10.8H10V14.8H13.8889V10.8Z" fill="#A1A4A6"/>
			</svg></div>`, i += "<span>" + e.templates.agenda_text(_.start_date, _.end_date, _) + "</span></div>";
          }
          i += "<div class='dhx_v_border'></div></div>", e._els.dhx_cal_data[0].innerHTML = i, e._els.dhx_cal_data[0].childNodes[0].scrollTop = e._agendaScrollTop || 0;
          var f = e._els.dhx_cal_data[0].childNodes[0];
          f.childNodes[f.childNodes.length - 1].style.height = f.offsetHeight < e._els.dhx_cal_data[0].offsetHeight ? "100%" : f.offsetHeight + "px";
          var y = e._els.dhx_cal_data[0].firstChild.childNodes, b = e._getNavDateElement();
          for (b && (b.innerHTML = e.templates.agenda_date(e._min_date, e._max_date, e._mode)), e._rendered = [], s = 0; s < y.length - 1; s++)
            e._rendered[s] = y[s];
        }
        e.render_view_data = function() {
          return this._mode == "agenda_legacy" && (e._agendaScrollTop = e._els.dhx_cal_data[0].childNodes[0].scrollTop, e._els.dhx_cal_data[0].childNodes[0].scrollTop = 0), n.apply(this, arguments);
        }, e.agenda_legacy_view = function(r) {
          e._min_date = e.config.agenda_start || e.date.agenda_legacy_start(e._date), e._max_date = e.config.agenda_end || e.date.add_agenda_legacy(e._min_date, 1), function(d) {
            if (d) {
              var i = e.locale.labels, s = e._waiAria.agendaHeadAttrString(), _ = e._waiAria.agendaHeadDateString(i.date), l = e._waiAria.agendaHeadDescriptionString(i.description);
              e._els.dhx_cal_header[0].innerHTML = "<div " + s + " class='dhx_agenda_line dhx_agenda_line_header'><div " + _ + ">" + i.date + "</div><span class = 'description_header' style='padding-left:25px' " + l + ">" + i.description + "</span></div>", e._table_view = !0, e.set_sizes();
            }
          }(r), r ? (e._cols = null, e._colsS = null, e._table_view = !0, o()) : e._table_view = !1;
        };
      });
    }
    function agenda_view(e) {
      e.date.add_agenda = function(o, r) {
        return e.date.add(o, 1 * r, "month");
      }, e.templates.agenda_time = function(o, r, d) {
        return d._timed ? `${this.event_date(o)} - ${this.event_date(r)}` : e.locale.labels.full_day;
      }, e.templates.agenda_text = function(o, r, d) {
        return d.text;
      };
      const a = e.date.date_to_str("%F %j"), t = e.date.date_to_str("%l");
      e.templates.agenda_day = function(o) {
        return `<div class="dhx_agenda_day_date">${a(o)}</div>
		<div class="dhx_agenda_day_dow">${t(o)}</div>`;
      }, e.templates.agenda_date = function(o, r) {
        return e.templates.month_date(e.getState().date);
      }, e.date.agenda_start = function(o) {
        return e.date.month_start(new Date(o));
      };
      let n = 0;
      e.attachEvent("onTemplatesReady", function() {
        var o = e.dblclick_dhx_cal_data;
        e.dblclick_dhx_cal_data = function() {
          if (this._mode == "agenda")
            !this.config.readonly && this.config.dblclick_create && this.addEventNow();
          else if (o)
            return o.apply(this, arguments);
        };
        var r = e.render_data;
        e.render_data = function(_) {
          if (this._mode != "agenda")
            return r.apply(this, arguments);
          i();
        };
        var d = e.render_view_data;
        function i() {
          const _ = e.get_visible_events();
          _.sort(function(f, y) {
            return f.start_date > y.start_date ? 1 : -1;
          });
          const l = {};
          let h = e.getState().min_date;
          const u = e.getState().max_date;
          for (; h.valueOf() < u.valueOf(); )
            l[h.valueOf()] = [], h = e.date.add(h, 1, "day");
          let m = !1;
          if (_.forEach((f) => {
            let y = e.date.day_start(new Date(f.start_date));
            for (; y.valueOf() < f.end_date.valueOf(); )
              l[y.valueOf()] && (l[y.valueOf()].push(f), m = !0), y = e.date.day_start(e.date.add(y, 1, "day"));
          }), m) {
            let f = "";
            for (let y in l)
              f += s(new Date(1 * y), l[y]);
            e._els.dhx_cal_data[0].innerHTML = f;
          } else
            e._els.dhx_cal_data[0].innerHTML = `<div class="dhx_cal_agenda_no_events">${e.locale.labels.agenda_tab}</div>`;
          e._els.dhx_cal_data[0].scrollTop = n;
        }
        function s(_, l) {
          if (!l.length)
            return "";
          let h = `
<div class="dhx_cal_agenda_day">
	<div class="dhx_cal_agenda_day_header">${e.templates.agenda_day(_)}</div>
	<div class="dhx_cal_agenda_day_events">
`;
          return l.forEach((u) => {
            h += function(m, f) {
              const y = e.templates.agenda_time(f.start_date, f.end_date, f), b = e.getState().select_id, c = e.templates.event_class(f.start_date, f.end_date, f), g = e.templates.agenda_text(f.start_date, f.end_date, f);
              let v = "";
              return (f.color || f.textColor) && (v = ` style="${f.color ? "--dhx-scheduler-event-background:" + f.color + ";" : ""}${f.textColor ? "--dhx-scheduler-event-color:" + f.textColor + ";" : ""}" `), `<div class="dhx_cal_agenda_event_line ${c || ""} ${f.id == b ? "dhx_cal_agenda_event_line_selected" : ""}" ${v} ${e.config.event_attribute}="${f.id}">
	<div class="dhx_cal_agenda_event_line_marker"></div>
	<div class="dhx_cal_agenda_event_line_time">${y}</div>
	<div class="dhx_cal_agenda_event_line_text">${g}</div>
</div>`;
            }(0, u);
          }), h += "</div></div>", h;
        }
        e.render_view_data = function() {
          return this._mode == "agenda" && (n = e._els.dhx_cal_data[0].scrollTop, e._els.dhx_cal_data[0].scrollTop = 0), d.apply(this, arguments);
        }, e.agenda_view = function(_) {
          _ ? (e._min_date = e.config.agenda_start || e.date.agenda_start(e._date), e._max_date = e.config.agenda_end || e.date.add_agenda(e._min_date, 1), e._cols = null, e._colsS = null, e._table_view = !0, e._getNavDateElement().innerHTML = e.templates.agenda_date(e._date), i()) : e._table_view = !1;
        };
      });
    }
    function all_timed(e) {
      e.config.all_timed = "short", e.config.all_timed_month = !1;
      var a = function(i) {
        return !((i.end_date - i.start_date) / 36e5 >= 24) || e._drag_mode == "resize" && e._drag_id == i.id;
      };
      e._safe_copy = function(i) {
        var s = null, _ = e._copy_event(i);
        return i.event_pid && (s = e.getEvent(i.event_pid)), s && s.isPrototypeOf(i) && (delete _.event_length, delete _.event_pid, delete _.rec_pattern, delete _.rec_type), _;
      };
      var t = e._pre_render_events_line, n = e._pre_render_events_table, o = function(i, s) {
        return this._table_view ? n.call(this, i, s) : t.call(this, i, s);
      };
      e._pre_render_events_line = e._pre_render_events_table = function(i, s) {
        if (!this.config.all_timed || this._table_view && this._mode != "month" || this._mode == "month" && !this.config.all_timed_month)
          return o.call(this, i, s);
        for (var _ = 0; _ < i.length; _++) {
          var l = i[_];
          if (!l._timed)
            if (this.config.all_timed != "short" || a(l)) {
              var h = this._safe_copy(l);
              l._virtual ? h._first_chunk = !1 : h._first_chunk = !0, h._drag_resize = !1, h._virtual = !0, h.start_date = new Date(h.start_date), y(l) ? (h.end_date = b(h.start_date), this.config.last_hour != 24 && (h.end_date = c(h.start_date, this.config.last_hour))) : h.end_date = new Date(l.end_date);
              var u = !1;
              h.start_date < this._max_date && h.end_date > this._min_date && h.start_date < h.end_date && (i[_] = h, u = !0);
              var m = this._safe_copy(l);
              if (m._virtual = !0, m.end_date = new Date(m.end_date), m.start_date < this._min_date ? m.start_date = c(this._min_date, this.config.first_hour) : m.start_date = c(b(l.start_date), this.config.first_hour), m.start_date < this._max_date && m.start_date < m.end_date) {
                if (!u) {
                  i[_--] = m;
                  continue;
                }
                i.splice(_ + 1, 0, m), m._last_chunk = !1;
              } else
                h._last_chunk = !0, h._drag_resize = !0;
            } else
              this._mode != "month" && i.splice(_--, 1);
        }
        var f = this._drag_mode != "move" && s;
        return o.call(this, i, f);
        function y(g) {
          var v = b(g.start_date);
          return +g.end_date > +v;
        }
        function b(g) {
          var v = e.date.add(g, 1, "day");
          return v = e.date.date_part(v);
        }
        function c(g, v) {
          var p = e.date.date_part(new Date(g));
          return p.setHours(v), p;
        }
      };
      var r = e.get_visible_events;
      e.get_visible_events = function(i) {
        return this.config.all_timed && this.config.multi_day ? r.call(this, !1) : r.call(this, i);
      }, e.attachEvent("onBeforeViewChange", function(i, s, _, l) {
        return e._allow_dnd = _ == "day" || _ == "week" || e.getView(_), !0;
      }), e._is_main_area_event = function(i) {
        return !!(i._timed || this.config.all_timed === !0 || this.config.all_timed == "short" && a(i));
      };
      var d = e.updateEvent;
      e.updateEvent = function(i) {
        var s, _, l = e.getEvent(i);
        l && (s = e.config.all_timed && !(e.isOneDayEvent(e._events[i]) || e.getState().drag_id)) && (_ = e.config.update_render, e.config.update_render = !0), d.apply(e, arguments), l && s && (e.config.update_render = _);
      };
    }
    function collision(e) {
      var a, t;
      function n(o) {
        e._get_section_view() && o && (a = e.getEvent(o)[e._get_section_property()]);
      }
      e.config.collision_limit = 1, e.attachEvent("onBeforeDrag", function(o) {
        return n(o), !0;
      }), e.attachEvent("onBeforeLightbox", function(o) {
        var r = e.getEvent(o);
        return t = [r.start_date, r.end_date], n(o), !0;
      }), e.attachEvent("onEventChanged", function(o) {
        if (!o || !e.getEvent(o))
          return !0;
        var r = e.getEvent(o);
        if (!e.checkCollision(r)) {
          if (!t)
            return !1;
          r.start_date = t[0], r.end_date = t[1], r._timed = this.isOneDayEvent(r);
        }
        return !0;
      }), e.attachEvent("onBeforeEventChanged", function(o, r, d) {
        return e.checkCollision(o);
      }), e.attachEvent("onEventAdded", function(o, r) {
        e.checkCollision(r) || e.deleteEvent(o);
      }), e.attachEvent("onEventSave", function(o, r, d) {
        if ((r = e._lame_clone(r)).id = o, !r.start_date || !r.end_date) {
          var i = e.getEvent(o);
          r.start_date = new Date(i.start_date), r.end_date = new Date(i.end_date);
        }
        return r.rec_type && e._roll_back_dates(r), e.checkCollision(r);
      }), e._check_sections_collision = function(o, r) {
        var d = e._get_section_property();
        return o[d] == r[d] && o.id != r.id;
      }, e.checkCollision = function(o) {
        var r = [], d = e.config.collision_limit;
        if (o.rec_type)
          for (var i = e.getRecDates(o), s = 0; s < i.length; s++)
            for (var _ = e.getEvents(i[s].start_date, i[s].end_date), l = 0; l < _.length; l++)
              (_[l].event_pid || _[l].id) != o.id && r.push(_[l]);
        else {
          r = e.getEvents(o.start_date, o.end_date);
          for (var h = 0; h < r.length; h++) {
            var u = r[h];
            if (u.id == o.id || u.event_length && [u.event_pid, u.event_length].join("#") == o.id) {
              r.splice(h, 1);
              break;
            }
          }
        }
        var m = e._get_section_view(), f = e._get_section_property(), y = !0;
        if (m) {
          var b = 0;
          for (h = 0; h < r.length; h++)
            r[h].id != o.id && this._check_sections_collision(r[h], o) && b++;
          b >= d && (y = !1);
        } else
          r.length >= d && (y = !1);
        if (!y) {
          var c = !e.callEvent("onEventCollision", [o, r]);
          return c || (o[f] = a || o[f]), c;
        }
        return y;
      };
    }
    function container_autoresize(e) {
      e.config.container_autoresize = !0, e.config.month_day_min_height = 90, e.config.min_grid_size = 25, e.config.min_map_size = 400;
      var a = e._pre_render_events, t = !0, n = 0, o = 0;
      e._pre_render_events = function(l, h) {
        if (!e.config.container_autoresize || !t)
          return a.apply(this, arguments);
        var u = this.xy.bar_height, m = this._colsS.heights, f = this._colsS.heights = [0, 0, 0, 0, 0, 0, 0], y = this._els.dhx_cal_data[0];
        if (l = this._table_view ? this._pre_render_events_table(l, h) : this._pre_render_events_line(l, h), this._table_view)
          if (h)
            this._colsS.heights = m;
          else {
            var b = y.firstChild;
            const k = b.querySelectorAll(".dhx_cal_month_row");
            if (k) {
              for (var c = 0; c < k.length; c++) {
                if (f[c]++, f[c] * u > this._colsS.height - this.xy.month_head_height) {
                  var g = k[c].querySelectorAll(".dhx_cal_month_cell"), v = this._colsS.height - this.xy.month_head_height;
                  1 * this.config.max_month_events !== this.config.max_month_events || f[c] <= this.config.max_month_events ? v = f[c] * u : (this.config.max_month_events + 1) * u > this._colsS.height - this.xy.month_head_height && (v = (this.config.max_month_events + 1) * u), k[c].style.height = v + this.xy.month_head_height + "px";
                  for (var p = 0; p < g.length; p++)
                    g[p].childNodes[1].style.height = v + "px";
                  f[c] = (f[c - 1] || 0) + g[0].offsetHeight;
                }
                f[c] = (f[c - 1] || 0) + k[c].querySelectorAll(".dhx_cal_month_cell")[0].offsetHeight;
              }
              f.unshift(0), b.parentNode.offsetHeight < b.parentNode.scrollHeight && b._h_fix;
            } else if (l.length || this._els.dhx_multi_day[0].style.visibility != "visible" || (f[0] = -1), l.length || f[0] == -1) {
              var x = (f[0] + 1) * u + 1;
              o != x + 1 && (this._obj.style.height = n - o + x - 1 + "px"), x += "px";
              const E = this._els.dhx_cal_navline[0].offsetHeight, D = this._els.dhx_cal_header[0].offsetHeight;
              y.style.height = this._obj.offsetHeight - E - D - (this.xy.margin_top || 0) + "px";
              var w = this._els.dhx_multi_day[0];
              w.style.height = x, w.style.visibility = f[0] == -1 ? "hidden" : "visible", (w = this._els.dhx_multi_day[1]).style.height = x, w.style.visibility = f[0] == -1 ? "hidden" : "visible", w.style.visibility == "hidden" ? w.style.display = "none" : w.style.display = "", w.className = f[0] ? "dhx_multi_day_icon" : "dhx_multi_day_icon_small", this._dy_shift = (f[0] + 1) * u, f[0] = 0;
            }
          }
        return l;
      };
      var r = ["dhx_cal_navline", "dhx_cal_header", "dhx_multi_day", "dhx_cal_data"], d = function(l) {
        n = 0;
        for (var h = 0; h < r.length; h++) {
          var u = r[h], m = e._els[u] ? e._els[u][0] : null, f = 0;
          switch (u) {
            case "dhx_cal_navline":
            case "dhx_cal_header":
              f = m.offsetHeight;
              break;
            case "dhx_multi_day":
              f = m ? m.offsetHeight - 1 : 0, o = f;
              break;
            case "dhx_cal_data":
              var y = e.getState().mode;
              if (m.childNodes[1] && y != "month") {
                let A = 0;
                for (let M = 0; M < m.childNodes.length; M++)
                  m.childNodes[M].offsetHeight > A && (A = m.childNodes[M].offsetHeight);
                f = A;
              } else
                f = Math.max(m.offsetHeight - 1, m.scrollHeight);
              if (y == "month")
                e.config.month_day_min_height && !l && (f = m.querySelectorAll(".dhx_cal_month_row").length * e.config.month_day_min_height), l && (m.style.height = f + "px");
              else if (y == "year")
                f = 190 * e.config.year_y;
              else if (y == "agenda") {
                if (f = 0, m.childNodes && m.childNodes.length)
                  for (var b = 0; b < m.childNodes.length; b++)
                    f += m.childNodes[b].offsetHeight;
                f + 2 < e.config.min_grid_size ? f = e.config.min_grid_size : f += 2;
              } else if (y == "week_agenda") {
                for (var c, g, v = e.xy.week_agenda_scale_height + e.config.min_grid_size, p = 0; p < m.childNodes.length; p++)
                  for (g = m.childNodes[p], b = 0; b < g.childNodes.length; b++) {
                    for (var x = 0, w = g.childNodes[b].childNodes[1], k = 0; k < w.childNodes.length; k++)
                      x += w.childNodes[k].offsetHeight;
                    c = x + e.xy.week_agenda_scale_height, (c = p != 1 || b != 2 && b != 3 ? c : 2 * c) > v && (v = c);
                  }
                f = 3 * v;
              } else if (y == "map") {
                f = 0;
                var E = m.querySelectorAll(".dhx_map_line");
                for (b = 0; b < E.length; b++)
                  f += E[b].offsetHeight;
                f + 2 < e.config.min_map_size ? f = e.config.min_map_size : f += 2;
              } else if (e._gridView)
                if (f = 0, m.childNodes[1].childNodes[0].childNodes && m.childNodes[1].childNodes[0].childNodes.length) {
                  for (E = m.childNodes[1].childNodes[0].childNodes[0].childNodes, b = 0; b < E.length; b++)
                    f += E[b].offsetHeight;
                  (f += 2) < e.config.min_grid_size && (f = e.config.min_grid_size);
                } else
                  f = e.config.min_grid_size;
              if (e.matrix && e.matrix[y]) {
                if (l)
                  f += 0, m.style.height = f + "px";
                else {
                  f = 0;
                  for (var D = e.matrix[y], S = D.y_unit, N = 0; N < S.length; N++)
                    f += D.getSectionHeight(S[N].key);
                  e.$container.clientWidth != e.$container.scrollWidth && (f += _());
                }
                f -= 1;
              }
              (y == "day" || y == "week" || e._props && e._props[y]) && (f += 2);
          }
          n += f += 1;
        }
        e._obj.style.height = n + "px", l || e.updateView();
      };
      function i() {
        t = !1, e.callEvent("onAfterSchedulerResize", []), t = !0;
      }
      var s = function() {
        if (!e.config.container_autoresize || !t)
          return !0;
        var l = e.getState().mode;
        if (!l)
          return !0;
        var h = window.requestAnimationFrame || window.setTimeout, u = document.documentElement.scrollTop;
        h(function() {
          !e.$destroyed && e.$initialized && d();
        }), e.matrix && e.matrix[l] || l == "month" ? h(function() {
          !e.$destroyed && e.$initialized && (d(!0), document.documentElement.scrollTop = u, i());
        }, 1) : i();
      };
      function _() {
        var l = document.createElement("div");
        l.style.cssText = "visibility:hidden;position:absolute;left:-1000px;width:100px;padding:0px;margin:0px;height:110px;min-height:100px;overflow-y:scroll;", document.body.appendChild(l);
        var h = l.offsetWidth - l.clientWidth;
        return document.body.removeChild(l), h;
      }
      e.attachEvent("onBeforeViewChange", function() {
        var l = e.config.container_autoresize;
        if (e.xy.$original_scroll_width || (e.xy.$original_scroll_width = e.xy.scroll_width), e.xy.scroll_width = l ? 0 : e.xy.$original_scroll_width, e.matrix)
          for (var h in e.matrix) {
            var u = e.matrix[h];
            u.$original_section_autoheight || (u.$original_section_autoheight = u.section_autoheight), u.section_autoheight = !l && u.$original_section_autoheight;
          }
        return !0;
      }), e.attachEvent("onViewChange", s), e.attachEvent("onXLE", s), e.attachEvent("onEventChanged", s), e.attachEvent("onEventCreated", s), e.attachEvent("onEventAdded", s), e.attachEvent("onEventDeleted", s), e.attachEvent("onAfterSchedulerResize", s), e.attachEvent("onClearAll", s), e.attachEvent("onBeforeExpand", function() {
        return t = !1, !0;
      }), e.attachEvent("onBeforeCollapse", function() {
        return t = !0, !0;
      });
    }
    function cookie(e) {
      function a(o) {
        return (o._obj.id || "scheduler") + "_settings";
      }
      var t = !0;
      e.attachEvent("onBeforeViewChange", function(o, r, d, i) {
        if (t && e._get_url_nav) {
          var s = e._get_url_nav();
          (s.date || s.mode || s.event) && (t = !1);
        }
        var _ = a(e);
        if (t) {
          t = !1;
          var l = function(u) {
            var m = u + "=";
            if (document.cookie.length > 0) {
              var f = document.cookie.indexOf(m);
              if (f != -1) {
                f += m.length;
                var y = document.cookie.indexOf(";", f);
                return y == -1 && (y = document.cookie.length), document.cookie.substring(f, y);
              }
            }
            return "";
          }(_);
          if (l) {
            e._min_date || (e._min_date = i), (l = unescape(l).split("@"))[0] = this._helpers.parseDate(l[0]);
            var h = this.isViewExists(l[1]) ? l[1] : d;
            return i = isNaN(+l[0]) ? i : l[0], window.setTimeout(function() {
              e.$destroyed || e.setCurrentView(i, h);
            }, 1), !1;
          }
        }
        return !0;
      }), e.attachEvent("onViewChange", function(o, r) {
        var d, i, s = a(e), _ = escape(this._helpers.formatDate(r) + "@" + o);
        i = s + "=" + _ + ((d = "expires=Sun, 31 Jan 9999 22:00:00 GMT") ? "; " + d : ""), document.cookie = i;
      });
      var n = e._load;
      e._load = function() {
        var o = arguments;
        if (e._date)
          n.apply(this, o);
        else {
          var r = this;
          window.setTimeout(function() {
            n.apply(r, o);
          }, 1);
        }
      };
    }
    function extend$1(e) {
      e._inited_multisection_copies || (e.attachEvent("onEventIdChange", function(a, t) {
        var n = this._multisection_copies;
        if (n && n[a] && !n[t]) {
          var o = n[a];
          delete n[a], n[t] = o;
        }
      }), e._inited_multisection_copies = !0), e._register_copies_array = function(a) {
        for (var t = 0; t < a.length; t++)
          this._register_copy(a[t]);
      }, e._register_copy = function(a) {
        if (this._multisection_copies) {
          this._multisection_copies[a.id] || (this._multisection_copies[a.id] = {});
          var t = a[this._get_section_property()];
          this._multisection_copies[a.id][t] = a;
        }
      }, e._get_copied_event = function(a, t) {
        if (!this._multisection_copies[a])
          return null;
        if (this._multisection_copies[a][t])
          return this._multisection_copies[a][t];
        var n = this._multisection_copies[a];
        if (e._drag_event && e._drag_event._orig_section && n[e._drag_event._orig_section])
          return n[e._drag_event._orig_section];
        var o = 1 / 0, r = null;
        for (var d in n)
          n[d]._sorder < o && (r = n[d], o = n[d]._sorder);
        return r;
      }, e._clear_copied_events = function() {
        this._multisection_copies = {};
      }, e._restore_render_flags = function(a) {
        for (var t = this._get_section_property(), n = 0; n < a.length; n++) {
          var o = a[n], r = e._get_copied_event(o.id, o[t]);
          if (r)
            for (var d in r)
              d.indexOf("_") === 0 && (o[d] = r[d]);
        }
      };
    }
    function daytimeline(e) {
      extend$1(e);
      var a = e.createTimelineView;
      e.createTimelineView = function(t) {
        if (t.render == "days") {
          var n = t.name, o = t.y_property = "timeline-week" + n;
          t.y_unit = [], t.render = "bar", t.days = t.days || 7, a.call(this, t), e.templates[n + "_scalex_class"] = function() {
          }, e.templates[n + "_scaley_class"] = function() {
          }, e.templates[n + "_scale_label"] = function(p, x, w) {
            return e.templates.day_date(x);
          }, e.date[n + "_start"] = function(p) {
            return p = e.date.week_start(p), p = e.date.add(p, t.x_step * t.x_start, t.x_unit);
          }, e.date["add_" + n] = function(p, x) {
            return e.date.add(p, x * t.days, "day");
          };
          var r = e._renderMatrix;
          e._renderMatrix = function(p, x) {
            p && function() {
              var w = new Date(e.getState().date), k = e.date[n + "_start"](w);
              k = e.date.date_part(k);
              var E = [], D = e.matrix[n];
              D.y_unit = E, D.order = {};
              for (var S = 0; S < t.days; S++)
                E.push({ key: +k, label: k }), D.order[D.y_unit[S].key] = S, k = e.date.add(k, 1, "day");
            }(), r.apply(this, arguments);
          };
          var d = e.checkCollision;
          e.checkCollision = function(p) {
            return p[o] && delete (p = function(x) {
              var w = {};
              for (var k in x)
                w[k] = x[k];
              return w;
            }(p))[o], d.apply(e, [p]);
          }, e.attachEvent("onBeforeDrag", function(p, x, w) {
            var k = w.target || w.srcElement, E = e._getClassName(k);
            if (x == "resize")
              E.indexOf("dhx_event_resize_end") < 0 ? e._w_line_drag_from_start = !0 : e._w_line_drag_from_start = !1;
            else if (x == "move" && E.indexOf("no_drag_move") >= 0)
              return !1;
            return !0;
          });
          var i = e["mouse_" + n];
          e["mouse_" + n] = function(p) {
            var x;
            this._drag_event && (x = this._drag_event._move_delta);
            var w = e.matrix[this._mode];
            if (w.scrollable && !p.converted && (p.converted = 1, p.x -= -w._x_scroll, p.y += w._y_scroll), x === void 0 && e._drag_mode == "move") {
              var k = { y: p.y };
              e._resolve_timeline_section(w, k);
              var E = p.x - w.dx, D = new Date(k.section);
              g(e._timeline_drag_date(w, E), D);
              var S = e._drag_event, N = this.getEvent(this._drag_id);
              N && (S._move_delta = (N.start_date - D) / 6e4, this.config.preserve_length && p._ignores && (S._move_delta = this._get_real_event_length(N.start_date, D, w), S._event_length = this._get_real_event_length(N.start_date, N.end_date, w)));
            }
            if (p = i.apply(e, arguments), e._drag_mode && e._drag_mode != "move") {
              var A = null;
              A = e._drag_event && e._drag_event["timeline-week" + n] ? new Date(e._drag_event["timeline-week" + n]) : new Date(p.section), p.y += Math.round((A - e.date.date_part(new Date(e._min_date))) / (6e4 * this.config.time_step)), e._drag_mode == "resize" && (p.resize_from_start = e._w_line_drag_from_start);
            } else if (e._drag_event) {
              var M = Math.floor(Math.abs(p.y / (1440 / e.config.time_step)));
              M *= p.y > 0 ? 1 : -1, p.y = p.y % (1440 / e.config.time_step);
              var C = e.date.date_part(new Date(e._min_date));
              C.valueOf() != new Date(p.section).valueOf() && (p.x = Math.floor((p.section - C) / 864e5), p.x += M);
            }
            return p;
          }, e.attachEvent("onEventCreated", function(p, x) {
            return e._events[p] && delete e._events[p][o], !0;
          }), e.attachEvent("onBeforeEventChanged", function(p, x, w, k) {
            return e._events[p.id] && delete e._events[p.id][o], !0;
          });
          var s = e._update_timeline_section;
          e._update_timeline_section = function(p) {
            var x, w;
            this._mode == n && (x = p.event) && (w = e._get_copied_event(x.id, e.date.day_start(new Date(x.start_date.valueOf())))) && (p.event._sorder = w._sorder, p.event._count = w._count), s.apply(this, arguments), x && w && (w._count = x._count, w._sorder = x._sorder);
          };
          var _ = e.render_view_data;
          e.render_view_data = function(p, x) {
            return this._mode == n && p && (p = f(p), e._restore_render_flags(p)), _.apply(e, [p, x]);
          };
          var l = e.get_visible_events;
          e.get_visible_events = function() {
            if (this._mode == n) {
              this._clear_copied_events(), e._max_date = e.date.date_part(e.date.add(e._min_date, t.days, "day"));
              var p = l.apply(e, arguments);
              return p = f(p), e._register_copies_array(p), p;
            }
            return l.apply(e, arguments);
          };
          var h = e.addEventNow;
          e.addEventNow = function(p) {
            if (e.getState().mode == n)
              if (p[o]) {
                var x = new Date(p[o]);
                m(x, p.start_date), m(x, p.end_date);
              } else {
                var w = new Date(p.start_date);
                p[o] = +e.date.date_part(w);
              }
            return h.apply(e, arguments);
          };
          var u = e._render_marked_timespan;
          e._render_marked_timespan = function() {
            if (e._mode != n)
              return u.apply(this, arguments);
          };
        } else
          a.apply(this, arguments);
        function m(p, x) {
          x.setDate(1), x.setFullYear(p.getFullYear()), x.setMonth(p.getMonth()), x.setDate(p.getDate());
        }
        function f(p) {
          for (var x = [], w = 0; w < p.length; w++) {
            var k = b(p[w]);
            if (e.isOneDayEvent(k))
              c(k), x.push(k);
            else {
              for (var E = new Date(Math.min(+k.end_date, +e._max_date)), D = new Date(Math.max(+k.start_date, +e._min_date)), S = []; +D < +E; ) {
                var N = b(k);
                N.start_date = D, N.end_date = new Date(Math.min(+v(N.start_date), +E)), D = v(D), c(N), x.push(N), S.push(N);
              }
              y(S, k);
            }
          }
          return x;
        }
        function y(p, x) {
          for (var w = !1, k = !1, E = 0, D = p.length; E < D; E++) {
            var S = p[E];
            w = +S._w_start_date == +x.start_date, k = +S._w_end_date == +x.end_date, S._no_resize_start = S._no_resize_end = !0, w && (S._no_resize_start = !1), k && (S._no_resize_end = !1);
          }
        }
        function b(p) {
          var x = e.getEvent(p.event_pid);
          return x && x.isPrototypeOf(p) ? (delete (p = e._copy_event(p)).event_length, delete p.event_pid, delete p.rec_pattern, delete p.rec_type) : p = e._lame_clone(p), p;
        }
        function c(p) {
          if (!p._w_start_date || !p._w_end_date) {
            var x = e.date, w = p._w_start_date = new Date(p.start_date), k = p._w_end_date = new Date(p.end_date);
            p[o] = +x.date_part(p.start_date), p._count || (p._count = 1), p._sorder || (p._sorder = 0);
            var E = k - w;
            p.start_date = new Date(e._min_date), g(w, p.start_date), p.end_date = new Date(+p.start_date + E), w.getTimezoneOffset() != k.getTimezoneOffset() && (p.end_date = new Date(p.end_date.valueOf() + 6e4 * (w.getTimezoneOffset() - k.getTimezoneOffset())));
          }
        }
        function g(p, x) {
          x.setMinutes(p.getMinutes()), x.setHours(p.getHours());
        }
        function v(p) {
          var x = e.date.add(p, 1, "day");
          return x = e.date.date_part(x);
        }
      };
    }
    const externalDrag = { from_scheduler: null, to_scheduler: null, drag_data: null, drag_placeholder: null, delete_dnd_holder: function() {
      var e = this.drag_placeholder;
      e && (e.parentNode && e.parentNode.removeChild(e), document.body.className = document.body.className.replace(" dhx_no_select", ""), this.drag_placeholder = null);
    }, copy_event_node: function(e, a) {
      for (var t = null, n = 0; n < a._rendered.length; n++) {
        var o = a._rendered[n];
        if (o.getAttribute(a.config.event_attribute) == e.id || o.getAttribute(a.config.event_attribute) == a._drag_id) {
          (t = o.cloneNode(!0)).style.position = t.style.top = t.style.left = "";
          break;
        }
      }
      return t || document.createElement("div");
    }, create_dnd_holder: function(e, a) {
      if (this.drag_placeholder)
        return this.drag_placeholder;
      var t = document.createElement("div"), n = a.templates.event_outside(e.start_date, e.end_date, e);
      return n ? t.innerHTML = n : t.appendChild(this.copy_event_node(e, a)), t.className = "dhx_drag_placeholder", t.style.position = "absolute", this.drag_placeholder = t, document.body.appendChild(t), document.body.className += " dhx_no_select", t;
    }, move_dnd_holder: function(e) {
      var a = { x: e.clientX, y: e.clientY };
      if (this.create_dnd_holder(this.drag_data.ev, this.from_scheduler), this.drag_placeholder) {
        var t = a.x, n = a.y, o = document.documentElement, r = document.body, d = this.drag_placeholder;
        d.style.left = 10 + t + (o && o.scrollLeft || r && r.scrollLeft || 0) - (o.clientLeft || 0) + "px", d.style.top = 10 + n + (o && o.scrollTop || r && r.scrollTop || 0) - (o.clientTop || 0) + "px";
      }
    }, clear_scheduler_dnd: function(e) {
      e._drag_id = e._drag_pos = e._drag_mode = e._drag_event = e._new_event = null;
    }, stop_drag: function(e) {
      e && this.clear_scheduler_dnd(e), this.delete_dnd_holder(), this.drag_data = null;
    }, inject_into_scheduler: function(e, a, t) {
      e._count = 1, e._sorder = 0, e.event_pid && e.event_pid != "0" && (e.event_pid = null, e.rec_type = e.rec_pattern = "", e.event_length = 0), a._drag_event = e, a._events[e.id] = e, a._drag_id = e.id, a._drag_mode = "move", t && a._on_mouse_move(t);
    }, start_dnd: function(e) {
      if (e.config.drag_out) {
        this.from_scheduler = e, this.to_scheduler = e;
        var a = this.drag_data = {};
        a.ev = e._drag_event, a.orig_id = e._drag_event.id;
      }
    }, land_into_scheduler: function(e, a) {
      if (!e.config.drag_in)
        return this.move_dnd_holder(a), !1;
      var t = this.drag_data, n = e._lame_clone(t.ev);
      if (e != this.from_scheduler) {
        n.id = e.uid();
        var o = n.end_date - n.start_date;
        n.start_date = new Date(e.getState().min_date), n.end_date = new Date(n.start_date.valueOf() + o);
      } else
        n.id = this.drag_data.orig_id, n._dhx_changed = !0;
      return this.drag_data.target_id = n.id, !!e.callEvent("onBeforeEventDragIn", [n.id, n, a]) && (this.to_scheduler = e, this.inject_into_scheduler(n, e, a), this.delete_dnd_holder(), e.updateView(), e.callEvent("onEventDragIn", [n.id, n, a]), !0);
    }, drag_from_scheduler: function(e, a) {
      if (this.drag_data && e._drag_id && e.config.drag_out) {
        if (!e.callEvent("onBeforeEventDragOut", [e._drag_id, e._drag_event, a]))
          return !1;
        this.to_scheduler == e && (this.to_scheduler = null), this.create_dnd_holder(this.drag_data.ev, e);
        var t = e._drag_id;
        return this.drag_data.target_id = null, delete e._events[t], this.clear_scheduler_dnd(e), e.updateEvent(t), e.callEvent("onEventDragOut", [t, this.drag_data.ev, a]), !0;
      }
      return !1;
    }, reset_event: function(e, a) {
      this.inject_into_scheduler(e, a), this.stop_drag(a), a.updateView();
    }, move_permanently: function(e, a, t, n) {
      n.callEvent("onEventAdded", [a.id, a]), this.inject_into_scheduler(e, t), this.stop_drag(t), e.event_pid && e.event_pid != "0" ? (t.callEvent("onConfirmedBeforeEventDelete", [e.id]), t.updateEvent(a.event_pid)) : t.deleteEvent(e.id), t.updateView(), n.updateView();
    } };
    let outerDragHandlerAttached = !1;
    const connectedSchedulers = [];
    function attachOuterDragHandler(e) {
      e.event(document.body, "mousemove", function(a) {
        var t = externalDrag, n = t.target_scheduler;
        if (n)
          if (t.from_scheduler) {
            if (!n._drag_id) {
              var o = t.to_scheduler;
              o && !t.drag_from_scheduler(o, a) || t.land_into_scheduler(n, a);
            }
          } else
            n.getState().drag_mode == "move" && n.config.drag_out && t.start_dnd(n);
        else
          t.from_scheduler && (t.to_scheduler ? t.drag_from_scheduler(t.to_scheduler, a) : t.move_dnd_holder(a));
        t.target_scheduler = null;
      }), e.event(document.body, "mouseup", function(a) {
        var t = externalDrag, n = t.from_scheduler, o = t.to_scheduler;
        if (n)
          if (o && n == o)
            n.updateEvent(t.drag_data.target_id);
          else if (o && n !== o) {
            var r = t.drag_data.ev, d = o.getEvent(t.drag_data.target_id);
            n.callEvent("onEventDropOut", [r.id, r, o, a]) ? t.move_permanently(r, d, n, o) : t.reset_event(r, n);
          } else
            r = t.drag_data.ev, n.callEvent("onEventDropOut", [r.id, r, null, a]) && t.reset_event(r, n);
        t.stop_drag(), t.current_scheduler = t.from_scheduler = t.to_scheduler = null;
      });
    }
    function processScheduler(e) {
      e.attachEvent("onSchedulerReady", function() {
        attachOuterDragHandler(e), outerDragHandlerAttached = !0;
      }, { once: !0 }), e.attachEvent("onDestroy", function() {
        outerDragHandlerAttached = !1;
        const a = connectedSchedulers.unshift();
        a && processScheduler(a);
      }, { once: !0 });
    }
    function drag_between(e) {
      window.Scheduler && window.Scheduler.plugin && (window.Scheduler._outer_drag = externalDrag), connectedSchedulers.push(e), outerDragHandlerAttached || processScheduler(e), e.config.drag_in = !0, e.config.drag_out = !0, e.templates.event_outside = function(t, n, o) {
      };
      var a = externalDrag;
      e.attachEvent("onTemplatesReady", function() {
        e.event(e._obj, "mousemove", function(t) {
          a.target_scheduler = e;
        }), e.event(e._obj, "mouseup", function(t) {
          a.target_scheduler = e;
        });
      });
    }
    function editors(e) {
      e.form_blocks.combo = { render: function(a) {
        a.cached_options || (a.cached_options = {});
        var t = "";
        return t += "<div class='" + a.type + "' ></div>";
      }, set_value: function(a, t, n, o) {
        ((function() {
          m();
          var u = e.attachEvent("onAfterLightbox", function() {
            m(), e.detachEvent(u);
          });
          function m() {
            if (a._combo && a._combo.DOMParent) {
              var f = a._combo;
              f.unload ? f.unload() : f.destructor && f.destructor(), f.DOMParent = f.DOMelem = null;
            }
          }
        }))(), window.dhx_globalImgPath = o.image_path || "/", a._combo = new dhtmlXCombo(a, o.name, a.offsetWidth - 8), o.onchange && a._combo.attachEvent("onChange", o.onchange), o.options_height && a._combo.setOptionHeight(o.options_height);
        var r = a._combo;
        if (r.enableFilteringMode(o.filtering, o.script_path || null, !!o.cache), o.script_path) {
          var d = n[o.map_to];
          d ? o.cached_options[d] ? (r.addOption(d, o.cached_options[d]), r.disable(1), r.selectOption(0), r.disable(0)) : e.ajax.get(o.script_path + "?id=" + d + "&uid=" + e.uid(), function(u) {
            var m, f = u.xmlDoc.responseText;
            try {
              m = JSON.parse(f).options[0].text;
            } catch {
              m = e.ajax.xpath("//option", u.xmlDoc)[0].childNodes[0].nodeValue;
            }
            o.cached_options[d] = m, r.addOption(d, m), r.disable(1), r.selectOption(0), r.disable(0);
          }) : r.setComboValue("");
        } else {
          for (var i = [], s = 0; s < o.options.length; s++) {
            var _ = o.options[s], l = [_.key, _.label, _.css];
            i.push(l);
          }
          if (r.addOption(i), n[o.map_to]) {
            var h = r.getIndexByValue(n[o.map_to]);
            r.selectOption(h);
          }
        }
      }, get_value: function(a, t, n) {
        var o = a._combo.getSelectedValue();
        return n.script_path && (n.cached_options[o] = a._combo.getSelectedText()), o;
      }, focus: function(a) {
      } }, e.form_blocks.radio = { render: function(a) {
        var t = "";
        t += `<div class='dhx_cal_ltext dhx_cal_radio ${a.vertical ? "dhx_cal_radio_vertical" : ""}' style='max-height:${a.height}px;'>`;
        for (var n = 0; n < a.options.length; n++) {
          var o = e.uid();
          t += "<label class='dhx_cal_radio_item' for='" + o + "'><input id='" + o + "' type='radio' name='" + a.name + "' value='" + a.options[n].key + "'><span> " + a.options[n].label + "</span></label>";
        }
        return t += "</div>";
      }, set_value: function(a, t, n, o) {
        for (var r = a.getElementsByTagName("input"), d = 0; d < r.length; d++) {
          r[d].checked = !1;
          var i = n[o.map_to] || t;
          r[d].value == i && (r[d].checked = !0);
        }
      }, get_value: function(a, t, n) {
        for (var o = a.getElementsByTagName("input"), r = 0; r < o.length; r++)
          if (o[r].checked)
            return o[r].value;
      }, focus: function(a) {
      } }, e.form_blocks.checkbox = { render: function(a) {
        return e.config.wide_form ? '<div class="dhx_cal_wide_checkbox"></div>' : "";
      }, set_value: function(a, t, n, o) {
        a = e._lightbox.querySelector(`#${o.id}`);
        var r = e.uid(), d = o.checked_value !== void 0 ? t == o.checked_value : !!t;
        a.className += " dhx_cal_checkbox";
        var i = "<input id='" + r + "' type='checkbox' value='true' name='" + o.name + "'" + (d ? "checked='true'" : "") + "'>", s = "<label for='" + r + "'>" + (e.locale.labels["section_" + o.name] || o.name) + "</label>";
        if (e.config.wide_form ? (a.innerHTML = s, a.nextSibling.innerHTML = i) : a.innerHTML = i + s, o.handler) {
          var _ = a.getElementsByTagName("input")[0];
          if (_.$_eventAttached)
            return;
          _.$_eventAttached = !0, e.event(_, "click", o.handler);
        }
      }, get_value: function(a, t, n) {
        var o = (a = e._lightbox.querySelector(`#${n.id}`)).getElementsByTagName("input")[0];
        return o || (o = a.nextSibling.getElementsByTagName("input")[0]), o.checked ? n.checked_value || !0 : n.unchecked_value || !1;
      }, focus: function(a) {
      } };
    }
    function expand(e) {
      e.ext.fullscreen = { toggleIcon: null }, e.expand = function() {
        if (e.callEvent("onBeforeExpand", [])) {
          var a = e._obj;
          do
            a._position = a.style.position || "", a.style.position = "static";
          while ((a = a.parentNode) && a.style);
          (a = e._obj).style.position = "absolute", a._width = a.style.width, a._height = a.style.height, a.style.width = a.style.height = "100%", a.style.top = a.style.left = "0px";
          var t = document.body;
          t.scrollTop = 0, (t = t.parentNode) && (t.scrollTop = 0), document.body._overflow = document.body.style.overflow || "", document.body.style.overflow = "hidden", e._maximize(), e.callEvent("onExpand", []);
        }
      }, e.collapse = function() {
        if (e.callEvent("onBeforeCollapse", [])) {
          var a = e._obj;
          do
            a.style.position = a._position;
          while ((a = a.parentNode) && a.style);
          (a = e._obj).style.width = a._width, a.style.height = a._height, document.body.style.overflow = document.body._overflow, e._maximize(), e.callEvent("onCollapse", []);
        }
      }, e.attachEvent("onTemplatesReady", function() {
        var a = document.createElement("div");
        a.className = "dhx_expand_icon", e.ext.fullscreen.toggleIcon = a, a.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
	<g>
	<line x1="0.5" y1="5" x2="0.5" y2="3.0598e-08" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line y1="0.5" x2="5" y2="0.5" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line x1="0.5" y1="11" x2="0.5" y2="16" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line y1="15.5" x2="5" y2="15.5" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line x1="11" y1="0.5" x2="16" y2="0.5" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line x1="15.5" y1="2.18557e-08" x2="15.5" y2="5" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line x1="11" y1="15.5" x2="16" y2="15.5" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	<line x1="15.5" y1="16" x2="15.5" y2="11" stroke="var(--dhx-scheduler-base-colors-icons)"/>
	</g>
	</svg>
	`, e._obj.appendChild(a), e.event(a, "click", function() {
          e.expanded ? e.collapse() : e.expand();
        });
      }), e._maximize = function() {
        this.expanded = !this.expanded, this.expanded ? this.ext.fullscreen.toggleIcon.classList.add("dhx_expand_icon--expanded") : this.ext.fullscreen.toggleIcon.classList.remove("dhx_expand_icon--expanded");
        for (var a = ["left", "top"], t = 0; t < a.length; t++) {
          var n = e["_prev_margin_" + a[t]];
          e.xy["margin_" + a[t]] ? (e["_prev_margin_" + a[t]] = e.xy["margin_" + a[t]], e.xy["margin_" + a[t]] = 0) : n && (e.xy["margin_" + a[t]] = e["_prev_margin_" + a[t]], delete e["_prev_margin_" + a[t]]);
        }
        e.setCurrentView();
      };
    }
    function grid_view(e) {
      e._grid = { names: {}, sort_rules: { int: function(a, t, n) {
        return 1 * n(a) < 1 * n(t) ? 1 : -1;
      }, str: function(a, t, n) {
        return n(a) < n(t) ? 1 : -1;
      }, date: function(a, t, n) {
        return new Date(n(a)) < new Date(n(t)) ? 1 : -1;
      } }, _getObjName: function(a) {
        return "grid_" + a;
      }, _getViewName: function(a) {
        return a.replace(/^grid_/, "");
      } }, e.createGridView = function(a) {
        var t = a.name || "grid", n = e._grid._getObjName(t);
        function o(i) {
          return !(i !== void 0 && (1 * i != i || i < 0));
        }
        e._grid.names[t] = t, e.config[t + "_start"] = a.from || /* @__PURE__ */ new Date(0), e.config[t + "_end"] = a.to || new Date(9999, 1, 1), e[n] = a, e[n].defPadding = 8, e[n].columns = e[n].fields, e[n].unit = a.unit || "month", e[n].step = a.step || 1, delete e[n].fields;
        for (var r = e[n].columns, d = 0; d < r.length; d++)
          o(r[d].width) && (r[d].initialWidth = r[d].width), o(r[d].paddingLeft) || delete r[d].paddingLeft, o(r[d].paddingRight) || delete r[d].paddingRight;
        e[n].select = a.select === void 0 || a.select, e.locale.labels[t + "_tab"] === void 0 && (e.locale.labels[t + "_tab"] = e[n].label || e.locale.labels.grid_tab), e[n]._selected_divs = [], e.date[t + "_start"] = function(i) {
          return e.date[a.unit + "_start"] ? e.date[a.unit + "_start"](i) : i;
        }, e.date["add_" + t] = function(i, s) {
          return e.date.add(i, s * e[n].step, e[n].unit);
        }, e.templates[t + "_date"] = function(i, s) {
          return e.config.rtl ? e.templates.day_date(s) + " - " + e.templates.day_date(i) : e.templates.day_date(i) + " - " + e.templates.day_date(s);
        }, e.templates[t + "_full_date"] = function(i, s, _) {
          return e.isOneDayEvent(_) ? this[t + "_single_date"](i) : e.config.rtl ? e.templates.day_date(s) + " &ndash; " + e.templates.day_date(i) : e.templates.day_date(i) + " &ndash; " + e.templates.day_date(s);
        }, e.templates[t + "_single_date"] = function(i) {
          return e.templates.day_date(i) + " " + this.event_date(i);
        }, e.templates[t + "_field"] = function(i, s) {
          return s[i];
        }, e.attachEvent("onTemplatesReady", function() {
          e.attachEvent("onEventSelected", function(_) {
            if (this._mode == t && e[n].select)
              return e._grid.selectEvent(_, t), !1;
          }), e.attachEvent("onEventUnselected", function(_) {
            this._mode == t && e[n].select && e._grid.unselectEvent("", t);
          });
          var i = e.render_data;
          e.render_data = function(_) {
            if (this._mode != t)
              return i.apply(this, arguments);
            e._grid._fill_grid_tab(n);
          };
          var s = e.render_view_data;
          e.render_view_data = function() {
            var _ = e._els.dhx_cal_data[0].lastChild;
            return this._mode == t && _ && (e._grid._gridScrollTop = _.scrollTop), s.apply(this, arguments);
          };
        }), e[t + "_view"] = function(i) {
          if (e._grid._sort_marker = null, delete e._gridView, e._grid._gridScrollTop = 0, e._rendered = [], e[n]._selected_divs = [], i) {
            var s = null, _ = null;
            e[n].paging ? (s = e.date[t + "_start"](new Date(e._date)), _ = e.date["add_" + t](s, 1)) : (s = e.config[t + "_start"], _ = e.config[t + "_end"]), e._min_date = s, e._max_date = _, e._grid.set_full_view(n);
            var l = "";
            +s > +/* @__PURE__ */ new Date(0) && +_ < +new Date(9999, 1, 1) && (l = e.templates[t + "_date"](s, _));
            var h = e._getNavDateElement();
            h && (h.innerHTML = l), e._gridView = n;
          }
        };
      }, e.dblclick_dhx_grid_area = function() {
        !this.config.readonly && this.config.dblclick_create && this.addEventNow();
      }, e._click.dhx_cal_header && (e._old_header_click = e._click.dhx_cal_header), e._click.dhx_cal_header = function(a) {
        if (e._gridView) {
          var t = a || window.event, n = e._grid._get_target_column(t, e._gridView);
          e._grid._toggle_sort_state(e._gridView, n.id), e.clear_view(), e._grid._fill_grid_tab(e._gridView);
        } else if (e._old_header_click)
          return e._old_header_click.apply(this, arguments);
      }, e._grid.selectEvent = function(a, t) {
        if (e.callEvent("onBeforeRowSelect", [a])) {
          var n = e._grid._getObjName(t);
          e.for_rendered(a, function(o) {
            o.classList.add("dhx_grid_event_selected"), e[n]._selected_divs.push(o);
          });
        }
      }, e._grid._unselectDiv = function(a) {
        a.className = a.classList.remove("dhx_grid_event_selected");
      }, e._grid.unselectEvent = function(a, t) {
        var n = e._grid._getObjName(t);
        if (n && e[n]._selected_divs)
          if (a) {
            for (o = 0; o < e[n]._selected_divs.length; o++)
              if (e[n]._selected_divs[o].getAttribute(e.config.event_attribute) == a) {
                e._grid._unselectDiv(e[n]._selected_divs[o]), e[n]._selected_divs.slice(o, 1);
                break;
              }
          } else {
            for (var o = 0; o < e[n]._selected_divs.length; o++)
              e._grid._unselectDiv(e[n]._selected_divs[o]);
            e[n]._selected_divs = [];
          }
      }, e._grid._get_target_column = function(a, t) {
        var n = a.originalTarget || a.srcElement;
        e._getClassName(n) == "dhx_grid_view_sort" && (n = n.parentNode);
        for (var o = 0, r = 0; r < n.parentNode.childNodes.length; r++)
          if (n.parentNode.childNodes[r] == n) {
            o = r;
            break;
          }
        return e[t].columns[o];
      }, e._grid._get_sort_state = function(a) {
        return e[a].sort;
      }, e._grid._toggle_sort_state = function(a, t) {
        var n = this._get_sort_state(a), o = e[a];
        n && n.column == t ? n.direction = n.direction == "asc" ? "desc" : "asc" : o.sort = { column: t, direction: "desc" };
      }, e._grid._get_sort_value_for_column = function(a) {
        var t = null;
        if (a.template) {
          var n = a.template;
          t = function(r) {
            return n(r.start_date, r.end_date, r);
          };
        } else {
          var o = a.id;
          o == "date" && (o = "start_date"), t = function(r) {
            return r[o];
          };
        }
        return t;
      }, e._grid.draw_sort_marker = function(a, t) {
        if (e._grid._sort_marker && (e._grid._sort_marker.className = e._grid._sort_marker.className.replace(/( )?dhx_grid_sort_(asc|desc)/, ""), e._grid._sort_marker.removeChild(e._grid._sort_marker.lastChild)), t) {
          var n = e._grid._get_column_node(a, t.column);
          n.className += " dhx_grid_sort_" + t.direction, e._grid._sort_marker = n;
          var o = "<div class='dhx_grid_view_sort' style='left:" + (+n.style.width.replace("px", "") - 15 + n.offsetLeft) + "px'>&nbsp;</div>";
          n.innerHTML += o;
        }
      }, e._grid.sort_grid = function(a) {
        a = a || { direction: "desc", value: function(n) {
          return n.start_date;
        }, rule: e._grid.sort_rules.date };
        var t = e.get_visible_events();
        return t.sort(function(n, o) {
          return a.rule(n, o, a.value);
        }), a.direction == "asc" && (t = t.reverse()), t;
      }, e._grid.set_full_view = function(a) {
        if (a) {
          var t = e._grid._print_grid_header(a);
          e._els.dhx_cal_header[0].innerHTML = t, e._table_view = !0, e.set_sizes();
        }
      }, e._grid._calcPadding = function(a, t) {
        return (a.paddingLeft !== void 0 ? 1 * a.paddingLeft : e[t].defPadding) + (a.paddingRight !== void 0 ? 1 * a.paddingRight : e[t].defPadding);
      }, e._grid._getStyles = function(a, t) {
        for (var n = [], o = "", r = 0; t[r]; r++)
          switch (o = t[r] + ":", t[r]) {
            case "text-align":
              a.align && n.push(o + a.align);
              break;
            case "vertical-align":
              a.valign && n.push(o + a.valign);
              break;
            case "padding-left":
              a.paddingLeft !== void 0 && n.push(o + (a.paddingLeft || "0") + "px");
              break;
            case "padding-right":
              a.paddingRight !== void 0 && n.push(o + (a.paddingRight || "0") + "px");
          }
        return n;
      }, e._grid._get_column_node = function(a, t) {
        for (var n = -1, o = 0; o < a.length; o++)
          if (a[o].id == t) {
            n = o;
            break;
          }
        return n < 0 ? null : e._obj.querySelectorAll(".dhx_grid_line > div")[n];
      }, e._grid._get_sort_rule = function(a) {
        var t, n = e[a], o = this._get_sort_state(a);
        if (o) {
          for (var r, d = 0; d < n.columns.length; d++)
            if (n.columns[d].id == o.column) {
              r = n.columns[d];
              break;
            }
          if (r) {
            var i = e._grid._get_sort_value_for_column(r), s = r.sort;
            typeof s != "function" && (s = e._grid.sort_rules[s] || e._grid.sort_rules.str), t = { direction: o.direction, rule: s, value: i };
          }
        }
        return t;
      }, e._grid._fill_grid_tab = function(a) {
        var t = e[a], n = this._get_sort_state(a), o = this._get_sort_rule(a);
        o && e._grid.draw_sort_marker(t.columns, n);
        for (var r = e._grid.sort_grid(o), d = e[a].columns, i = "<div>", s = -1, _ = 0; _ < d.length; _++)
          s += d[_].width, _ < d.length - 1 && (i += "<div class='dhx_grid_v_border' style='" + (e.config.rtl ? "right" : "left") + ":" + s + "px'></div>");
        for (i += "</div>", i += "<div class='dhx_grid_area'><table " + e._waiAria.gridAttrString() + ">", _ = 0; _ < r.length; _++)
          i += e._grid._print_event_row(r[_], a);
        i += "</table></div>", e._els.dhx_cal_data[0].innerHTML = i, e._els.dhx_cal_data[0].lastChild.scrollTop = e._grid._gridScrollTop || 0;
        var l = e._els.dhx_cal_data[0].getElementsByTagName("tr");
        for (e._rendered = [], _ = 0; _ < l.length; _++)
          e._rendered[_] = l[_];
      }, e._grid._getCellContent = function(a, t) {
        var n = e.getState().mode;
        return t.template ? t.template(a.start_date, a.end_date, a) : t.id == "date" ? e.templates[n + "_full_date"](a.start_date, a.end_date, a) : t.id == "start_date" || t.id == "end_date" ? e.templates[n + "_single_date"](a[t.id]) : e.templates[n + "_field"](t.id, a);
      }, e._grid._print_event_row = function(a, t) {
        var n = [];
        a.color && n.push("--dhx-scheduler-event-background:" + a.color), a.textColor && n.push("--dhx-scheduler-event-color:" + a.textColor), a._text_style && n.push(a._text_style), e[t].rowHeight && n.push("height:" + e[t].rowHeight + "px");
        var o = "";
        n.length && (o = "style='" + n.join(";") + "'");
        var r = e[t].columns, d = e.templates.event_class(a.start_date, a.end_date, a);
        e.getState().select_id == a.id && (d += " dhx_grid_event_selected");
        for (var i = "<tr " + e._waiAria.gridRowAttrString(a) + " class='dhx_grid_event" + (d ? " " + d : "") + "' event_id='" + a.id + "' " + e.config.event_attribute + "='" + a.id + "' " + o + ">", s = ["text-align", "vertical-align", "padding-left", "padding-right"], _ = 0; _ < r.length; _++) {
          var l = e._grid._getCellContent(a, r[_]), h = e._waiAria.gridCellAttrString(a, r[_], l), u = e._grid._getStyles(r[_], s), m = r[_].css ? ' class="' + r[_].css + '"' : "";
          i += "<td " + h + " style='width:" + r[_].width + "px;" + u.join(";") + "' " + m + ">" + l + "</td>";
        }
        return i += "<td class='dhx_grid_dummy'></td></tr>";
      }, e._grid._print_grid_header = function(a) {
        for (var t = "<div class='dhx_grid_line'>", n = e[a].columns, o = [], r = n.length, d = e._obj.clientWidth - 2 * n.length - 20, i = 0; i < n.length; i++) {
          var s = 1 * n[i].initialWidth;
          isNaN(s) || n[i].initialWidth === "" || n[i].initialWidth === null || typeof n[i].initialWidth == "boolean" ? o[i] = null : (r--, d -= s, o[i] = s);
        }
        for (var _ = Math.floor(d / r), l = ["text-align", "padding-left", "padding-right"], h = 0; h < n.length; h++) {
          var u = o[h] ? o[h] : _;
          n[h].width = u;
          var m = e._grid._getStyles(n[h], l);
          t += "<div class='dhx_grid_column_label' style='line-height: " + e.xy.scale_height + "px;width:" + n[h].width + "px;" + m.join(";") + "'>" + (n[h].label === void 0 ? n[h].id : n[h].label) + "</div>";
        }
        return t += "</div>";
      };
    }
    function html_templates(e) {
      e.attachEvent("onTemplatesReady", function() {
        for (var a = document.body.getElementsByTagName("DIV"), t = 0; t < a.length; t++) {
          var n = a[t].className || "";
          if ((n = n.split(":")).length == 2 && n[0] == "template") {
            var o = 'return "' + (a[t].innerHTML || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]+/g, "") + '";';
            o = unescape(o).replace(/\{event\.([a-z]+)\}/g, function(r, d) {
              return '"+ev.' + d + '+"';
            }), e.templates[n[1]] = Function("start", "end", "ev", o), a[t].style.display = "none";
          }
        }
      });
    }
    function keyboard_shortcuts(e) {
      e.$keyboardNavigation.shortcuts = { createCommand: function() {
        return { modifiers: { shift: !1, alt: !1, ctrl: !1, meta: !1 }, keyCode: null };
      }, parse: function(a) {
        for (var t = [], n = this.getExpressions(this.trim(a)), o = 0; o < n.length; o++) {
          for (var r = this.getWords(n[o]), d = this.createCommand(), i = 0; i < r.length; i++)
            this.commandKeys[r[i]] ? d.modifiers[r[i]] = !0 : this.specialKeys[r[i]] ? d.keyCode = this.specialKeys[r[i]] : d.keyCode = r[i].charCodeAt(0);
          t.push(d);
        }
        return t;
      }, getCommandFromEvent: function(a) {
        var t = this.createCommand();
        t.modifiers.shift = !!a.shiftKey, t.modifiers.alt = !!a.altKey, t.modifiers.ctrl = !!a.ctrlKey, t.modifiers.meta = !!a.metaKey, t.keyCode = a.which || a.keyCode, t.keyCode >= 96 && t.keyCode <= 105 && (t.keyCode -= 48);
        var n = String.fromCharCode(t.keyCode);
        return n && (t.keyCode = n.toLowerCase().charCodeAt(0)), t;
      }, getHashFromEvent: function(a) {
        return this.getHash(this.getCommandFromEvent(a));
      }, getHash: function(a) {
        var t = [];
        for (var n in a.modifiers)
          a.modifiers[n] && t.push(n);
        return t.push(a.keyCode), t.join(this.junctionChar);
      }, getExpressions: function(a) {
        return a.split(this.junctionChar);
      }, getWords: function(a) {
        return a.split(this.combinationChar);
      }, trim: function(a) {
        return a.replace(/\s/g, "");
      }, junctionChar: ",", combinationChar: "+", commandKeys: { shift: 16, alt: 18, ctrl: 17, meta: !0 }, specialKeys: { backspace: 8, tab: 9, enter: 13, esc: 27, space: 32, up: 38, down: 40, left: 37, right: 39, home: 36, end: 35, pageup: 33, pagedown: 34, delete: 46, insert: 45, plus: 107, f1: 112, f2: 113, f3: 114, f4: 115, f5: 116, f6: 117, f7: 118, f8: 119, f9: 120, f10: 121, f11: 122, f12: 123 } };
    }
    function eventhandler(e) {
      e.$keyboardNavigation.EventHandler = { _handlers: null, findHandler: function(a) {
        this._handlers || (this._handlers = {});
        var t = e.$keyboardNavigation.shortcuts.getHash(a);
        return this._handlers[t];
      }, doAction: function(a, t) {
        var n = this.findHandler(a);
        n && (n.call(this, t), t.preventDefault ? t.preventDefault() : t.returnValue = !1);
      }, bind: function(a, t) {
        this._handlers || (this._handlers = {});
        for (var n = e.$keyboardNavigation.shortcuts, o = n.parse(a), r = 0; r < o.length; r++)
          this._handlers[n.getHash(o[r])] = t;
      }, unbind: function(a) {
        for (var t = e.$keyboardNavigation.shortcuts, n = t.parse(a), o = 0; o < n.length; o++)
          this._handlers[t.getHash(n[o])] && delete this._handlers[t.getHash(n[o])];
      }, bindAll: function(a) {
        for (var t in a)
          this.bind(t, a[t]);
      }, initKeys: function() {
        this._handlers || (this._handlers = {}), this.keys && this.bindAll(this.keys);
      } };
    }
    function trap_modal_focus(e) {
      e.$keyboardNavigation.getFocusableNodes = e._getFocusableNodes, e.$keyboardNavigation.trapFocus = function(a, t) {
        if (t.keyCode != 9)
          return !1;
        for (var n, o = e.$keyboardNavigation.getFocusableNodes(a), r = document.activeElement, d = -1, i = 0; i < o.length; i++)
          if (o[i] == r) {
            d = i;
            break;
          }
        if (t.shiftKey) {
          if (n = o[d <= 0 ? o.length - 1 : d - 1])
            return n.focus(), t.preventDefault(), !0;
        } else if (n = o[d >= o.length - 1 ? 0 : d + 1])
          return n.focus(), t.preventDefault(), !0;
        return !1;
      };
    }
    function marker(e) {
      e.$keyboardNavigation.marker = { clear: function() {
        for (var a = e.$container.querySelectorAll(".dhx_focus_slot"), t = 0; t < a.length; t++)
          a[t].parentNode.removeChild(a[t]);
      }, createElement: function() {
        var a = document.createElement("div");
        return a.setAttribute("tabindex", -1), a.className = "dhx_focus_slot", a;
      }, renderMultiple: function(a, t, n) {
        for (var o = [], r = new Date(a), d = new Date(Math.min(t.valueOf(), e.date.add(e.date.day_start(new Date(a)), 1, "day").valueOf())); r.valueOf() < t.valueOf(); )
          o = o.concat(n.call(this, r, new Date(Math.min(d.valueOf(), t.valueOf())))), r = e.date.day_start(e.date.add(r, 1, "day")), d = e.date.day_start(e.date.add(r, 1, "day")), d = new Date(Math.min(d.valueOf(), t.valueOf()));
        return o;
      }, render: function(a, t, n) {
        this.clear();
        var o = [], r = e.$keyboardNavigation.TimeSlot.prototype._modes;
        switch (e.$keyboardNavigation.TimeSlot.prototype._getMode()) {
          case r.units:
            o = this.renderVerticalMarker(a, t, n);
            break;
          case r.timeline:
            o = this.renderTimelineMarker(a, t, n);
            break;
          case r.year:
            o = o.concat(this.renderMultiple(a, t, this.renderYearMarker));
            break;
          case r.month:
            o = this.renderMonthMarker(a, t);
            break;
          case r.weekAgenda:
            o = o.concat(this.renderMultiple(a, t, this.renderWeekAgendaMarker));
            break;
          case r.list:
            o = this.renderAgendaMarker(a, t);
            break;
          case r.dayColumns:
            o = o.concat(this.renderMultiple(a, t, this.renderVerticalMarker));
        }
        this.addWaiAriaLabel(o, a, t, n), this.addDataAttributes(o, a, t, n);
        for (var d = o.length - 1; d >= 0; d--)
          if (o[d].offsetWidth)
            return o[d];
        return null;
      }, addDataAttributes: function(a, t, n, o) {
        for (var r = e.date.date_to_str(e.config.api_date), d = r(t), i = r(n), s = 0; s < a.length; s++)
          a[s].setAttribute("data-start-date", d), a[s].setAttribute("data-end-date", i), o && a[s].setAttribute("data-section", o);
      }, addWaiAriaLabel: function(a, t, n, o) {
        var r = "", d = e.getState().mode, i = !1;
        if (r += e.templates.day_date(t), e.date.day_start(new Date(t)).valueOf() != t.valueOf() && (r += " " + e.templates.hour_scale(t), i = !0), e.date.day_start(new Date(t)).valueOf() != e.date.day_start(new Date(n)).valueOf() && (r += " - " + e.templates.day_date(n), (i || e.date.day_start(new Date(n)).valueOf() != n.valueOf()) && (r += " " + e.templates.hour_scale(n))), o) {
          if (e.matrix && e.matrix[d]) {
            const _ = e.matrix[d], l = _.y_unit[_.order[o]];
            r += ", " + e.templates[d + "_scale_label"](l.key, l.label, l);
          } else if (e._props && e._props[d]) {
            const _ = e._props[d], l = _.options[_.order[o]];
            r += ", " + e.templates[d + "_scale_text"](l.key, l.label, l);
          }
        }
        for (var s = 0; s < a.length; s++)
          e._waiAria.setAttributes(a[s], { "aria-label": r, "aria-live": "polite" });
      }, renderWeekAgendaMarker: function(a, t) {
        for (var n = e.$container.querySelectorAll(".dhx_wa_day_cont .dhx_wa_scale_bar"), o = e.date.week_start(new Date(e.getState().min_date)), r = -1, d = e.date.day_start(new Date(a)), i = 0; i < n.length && (r++, e.date.day_start(new Date(o)).valueOf() != d.valueOf()); i++)
          o = e.date.add(o, 1, "day");
        return r != -1 ? this._wrapDiv(n[r]) : [];
      }, _wrapDiv: function(a) {
        var t = this.createElement();
        return t.style.top = a.offsetTop + "px", t.style.left = a.offsetLeft + "px", t.style.width = a.offsetWidth + "px", t.style.height = a.offsetHeight + "px", a.appendChild(t), [t];
      }, renderYearMarker: function(a, t) {
        var n = e._get_year_cell(a);
        n.style.position = "relative";
        var o = this.createElement();
        return o.style.top = "0px", o.style.left = "0px", o.style.width = "100%", o.style.height = "100%", n.appendChild(o), [o];
      }, renderAgendaMarker: function(a, t) {
        var n = this.createElement();
        return n.style.height = "1px", n.style.width = "100%", n.style.opacity = 1, n.style.top = "0px", n.style.left = "0px", e.$container.querySelector(".dhx_cal_data").appendChild(n), [n];
      }, renderTimelineMarker: function(a, t, n) {
        var o = e._lame_copy({}, e.matrix[e._mode]), r = o._scales;
        o.round_position = !1;
        var d = [], i = a ? new Date(a) : e._min_date, s = t ? new Date(t) : e._max_date;
        if (i.valueOf() < e._min_date.valueOf() && (i = new Date(e._min_date)), s.valueOf() > e._max_date.valueOf() && (s = new Date(e._max_date)), !o._trace_x)
          return d;
        for (var _ = 0; _ < o._trace_x.length && !e._is_column_visible(o._trace_x[_]); _++)
          ;
        if (_ == o._trace_x.length)
          return d;
        var l = r[n];
        if (!(i < t && s > a))
          return d;
        var h = this.createElement();
        let u, m;
        function f(v, p) {
          p.setDate(1), p.setFullYear(v.getFullYear()), p.setMonth(v.getMonth()), p.setDate(v.getDate());
        }
        if (e.getView().days) {
          const v = new Date(a);
          f(e._min_date, v);
          const p = new Date(t);
          f(e._min_date, p), u = e._timeline_getX({ start_date: v }, !1, o), m = e._timeline_getX({ start_date: p }, !1, o);
        } else
          u = e._timeline_getX({ start_date: a }, !1, o), m = e._timeline_getX({ start_date: t }, !1, o);
        var y = o._section_height[n] - 1 || o.dy - 1, b = 0;
        e._isRender("cell") && (b = l.offsetTop, u += o.dx, m += o.dx, l = e.$container.querySelector(".dhx_cal_data"));
        var c = Math.max(1, m - u - 1);
        let g = "left";
        return e.config.rtl && (g = "right"), h.style.cssText = `height:${y}px; ${g}:${u}px; width:${c}px; top:${b}px;`, l && (l.appendChild(h), d.push(h)), d;
      }, renderMonthCell: function(a) {
        for (var t = e.$container.querySelectorAll(".dhx_month_head"), n = [], o = 0; o < t.length; o++)
          n.push(t[o].parentNode);
        var r = -1, d = 0, i = -1, s = e.date.week_start(new Date(e.getState().min_date)), _ = e.date.day_start(new Date(a));
        for (o = 0; o < n.length && (r++, i == 6 ? (d++, i = 0) : i++, e.date.day_start(new Date(s)).valueOf() != _.valueOf()); o++)
          s = e.date.add(s, 1, "day");
        if (r == -1)
          return [];
        var l = e._colsS[i], h = e._colsS.heights[d], u = this.createElement();
        u.style.top = h + "px", u.style.left = l + "px", u.style.width = e._cols[i] + "px", u.style.height = (e._colsS.heights[d + 1] - h || e._colsS.height) + "px";
        var m = e.$container.querySelector(".dhx_cal_data"), f = m.querySelector("table");
        return f.nextSibling ? m.insertBefore(u, f.nextSibling) : m.appendChild(u), u;
      }, renderMonthMarker: function(a, t) {
        for (var n = [], o = a; o.valueOf() < t.valueOf(); )
          n.push(this.renderMonthCell(o)), o = e.date.add(o, 1, "day");
        return n;
      }, renderVerticalMarker: function(a, t, n) {
        var o = e.locate_holder_day(a), r = [], d = null, i = e.config;
        if (e._ignores[o])
          return r;
        if (e._props && e._props[e._mode] && n) {
          var s = e._props[e._mode];
          o = s.order[n];
          var _ = s.order[n];
          s.days > 1 ? o = e.locate_holder_day(a) + _ : (o = _, s.size && o > s.position + s.size && (o = 0));
        }
        if (!(d = e.locate_holder(o)) || d.querySelector(".dhx_scale_hour"))
          return document.createElement("div");
        var l = Math.max(60 * a.getHours() + a.getMinutes(), 60 * i.first_hour), h = Math.min(60 * t.getHours() + t.getMinutes(), 60 * i.last_hour);
        if (!h && e.date.day_start(new Date(t)).valueOf() > e.date.day_start(new Date(a)).valueOf() && (h = 60 * i.last_hour), h <= l)
          return [];
        var u = this.createElement(), m = e.config.hour_size_px * i.last_hour + 1, f = 36e5;
        return u.style.top = Math.round((60 * l * 1e3 - e.config.first_hour * f) * e.config.hour_size_px / f) % m + "px", u.style.lineHeight = u.style.height = Math.max(Math.round(60 * (h - l) * 1e3 * e.config.hour_size_px / f) % m, 1) + "px", u.style.width = "100%", d.appendChild(u), r.push(u), r[0];
      } };
    }
    function scheduler_node(e) {
      e.$keyboardNavigation.SchedulerNode = function() {
      }, e.$keyboardNavigation.SchedulerNode.prototype = e._compose(e.$keyboardNavigation.EventHandler, { getDefaultNode: function() {
        var a = new e.$keyboardNavigation.TimeSlot();
        return a.isValid() || (a = a.fallback()), a;
      }, _modes: { month: "month", year: "year", dayColumns: "dayColumns", timeline: "timeline", units: "units", weekAgenda: "weekAgenda", list: "list" }, getMode: function() {
        var a = e.getState().mode;
        return e.matrix && e.matrix[a] ? this._modes.timeline : e._props && e._props[a] ? this._modes.units : a == "month" ? this._modes.month : a == "year" ? this._modes.year : a == "week_agenda" ? this._modes.weekAgenda : a == "map" || a == "agenda" || e._grid && e["grid_" + a] ? this._modes.list : this._modes.dayColumns;
      }, focus: function() {
        e.focus();
      }, blur: function() {
      }, disable: function() {
        e.$container.setAttribute("tabindex", "0");
      }, enable: function() {
        e.$container && e.$container.removeAttribute("tabindex");
      }, isEnabled: function() {
        return e.$container.hasAttribute("tabindex");
      }, _compareEvents: function(a, t) {
        return a.start_date.valueOf() == t.start_date.valueOf() ? a.id > t.id ? 1 : -1 : a.start_date.valueOf() > t.start_date.valueOf() ? 1 : -1;
      }, _pickEvent: function(a, t, n, o) {
        var r = e.getState();
        a = new Date(Math.max(r.min_date.valueOf(), a.valueOf())), t = new Date(Math.min(r.max_date.valueOf(), t.valueOf()));
        var d = e.getEvents(a, t);
        d.sort(this._compareEvents), o && (d = d.reverse());
        for (var i = !!n, s = 0; s < d.length && i; s++)
          d[s].id == n && (i = !1), d.splice(s, 1), s--;
        for (s = 0; s < d.length; s++)
          if (new e.$keyboardNavigation.Event(d[s].id).getNode())
            return d[s];
        return null;
      }, nextEventHandler: function(a) {
        var t = e.$keyboardNavigation.dispatcher.activeNode, n = a || t && t.eventId, o = null;
        if (n && e.getEvent(n)) {
          var r = e.getEvent(n);
          o = e.$keyboardNavigation.SchedulerNode.prototype._pickEvent(r.start_date, e.date.add(r.start_date, 1, "year"), r.id, !1);
        }
        if (!o && !a) {
          var d = e.getState();
          o = e.$keyboardNavigation.SchedulerNode.prototype._pickEvent(d.min_date, e.date.add(d.min_date, 1, "year"), null, !1);
        }
        if (o) {
          var i = new e.$keyboardNavigation.Event(o.id);
          i.isValid() ? (t && t.blur(), e.$keyboardNavigation.dispatcher.setActiveNode(i)) : this.nextEventHandler(o.id);
        }
      }, prevEventHandler: function(a) {
        var t = e.$keyboardNavigation.dispatcher.activeNode, n = a || t && t.eventId, o = null;
        if (n && e.getEvent(n)) {
          var r = e.getEvent(n);
          o = e.$keyboardNavigation.SchedulerNode.prototype._pickEvent(e.date.add(r.end_date, -1, "year"), r.end_date, r.id, !0);
        }
        if (!o && !a) {
          var d = e.getState();
          o = e.$keyboardNavigation.SchedulerNode.prototype._pickEvent(e.date.add(d.max_date, -1, "year"), d.max_date, null, !0);
        }
        if (o) {
          var i = new e.$keyboardNavigation.Event(o.id);
          i.isValid() ? (t && t.blur(), e.$keyboardNavigation.dispatcher.setActiveNode(i)) : this.prevEventHandler(o.id);
        }
      }, keys: { "alt+1, alt+2, alt+3, alt+4, alt+5, alt+6, alt+7, alt+8, alt+9": function(a) {
        var t = e.$keyboardNavigation.HeaderCell.prototype.getNodes(".dhx_cal_navline .dhx_cal_tab"), n = a.key;
        n === void 0 && (n = a.keyCode - 48), t[1 * n - 1] && t[1 * n - 1].click();
      }, "ctrl+left,meta+left": function(a) {
        e._click.dhx_cal_prev_button();
      }, "ctrl+right,meta+right": function(a) {
        e._click.dhx_cal_next_button();
      }, "ctrl+up,meta+up": function(a) {
        e.$container.querySelector(".dhx_cal_data").scrollTop -= 20;
      }, "ctrl+down,meta+down": function(a) {
        e.$container.querySelector(".dhx_cal_data").scrollTop += 20;
      }, e: function() {
        this.nextEventHandler();
      }, home: function() {
        e.setCurrentView(/* @__PURE__ */ new Date());
      }, "shift+e": function() {
        this.prevEventHandler();
      }, "ctrl+enter,meta+enter": function() {
        e.addEventNow({ start_date: new Date(e.getState().date) });
      }, "ctrl+c,meta+c": function(a) {
        e._key_nav_copy_paste(a);
      }, "ctrl+v,meta+v": function(a) {
        e._key_nav_copy_paste(a);
      }, "ctrl+x,meta+x": function(a) {
        e._key_nav_copy_paste(a);
      } } }), e.$keyboardNavigation.SchedulerNode.prototype.bindAll(e.$keyboardNavigation.SchedulerNode.prototype.keys);
    }
    function nav_node(e) {
      e.$keyboardNavigation.KeyNavNode = function() {
      }, e.$keyboardNavigation.KeyNavNode.prototype = e._compose(e.$keyboardNavigation.EventHandler, { isValid: function() {
        return !0;
      }, fallback: function() {
        return null;
      }, moveTo: function(a) {
        e.$keyboardNavigation.dispatcher.setActiveNode(a);
      }, compareTo: function(a) {
        if (!a)
          return !1;
        for (var t in this) {
          if (!!this[t] != !!a[t])
            return !1;
          var n = !(!this[t] || !this[t].toString), o = !(!a[t] || !a[t].toString);
          if (o != n)
            return !1;
          if (o && n) {
            if (a[t].toString() != this[t].toString())
              return !1;
          } else if (a[t] != this[t])
            return !1;
        }
        return !0;
      }, getNode: function() {
      }, focus: function() {
        var a = this.getNode();
        a && (a.setAttribute("tabindex", "-1"), a.focus && a.focus());
      }, blur: function() {
        var a = this.getNode();
        a && a.setAttribute("tabindex", "-1");
      } });
    }
    function header_cell(e) {
      e.$keyboardNavigation.HeaderCell = function(a) {
        this.index = a || 0;
      }, e.$keyboardNavigation.HeaderCell.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { getNode: function(a) {
        a = a || this.index || 0;
        var t = this.getNodes();
        if (t[a])
          return t[a];
      }, getNodes: function(a) {
        a = a || [".dhx_cal_navline .dhx_cal_prev_button", ".dhx_cal_navline .dhx_cal_next_button", ".dhx_cal_navline .dhx_cal_today_button", ".dhx_cal_navline .dhx_cal_tab"].join(", ");
        var t = Array.prototype.slice.call(e.$container.querySelectorAll(a));
        return t.sort(function(n, o) {
          return n.offsetLeft - o.offsetLeft;
        }), t;
      }, _handlers: null, isValid: function() {
        return !!this.getNode(this.index);
      }, fallback: function() {
        var a = this.getNode(0);
        return a || (a = new e.$keyboardNavigation.TimeSlot()), a;
      }, keys: { left: function() {
        var a = this.index - 1;
        a < 0 && (a = this.getNodes().length - 1), this.moveTo(new e.$keyboardNavigation.HeaderCell(a));
      }, right: function() {
        var a = this.index + 1;
        a >= this.getNodes().length && (a = 0), this.moveTo(new e.$keyboardNavigation.HeaderCell(a));
      }, down: function() {
        this.moveTo(new e.$keyboardNavigation.TimeSlot());
      }, enter: function() {
        var a = this.getNode();
        a && a.click();
      } } }), e.$keyboardNavigation.HeaderCell.prototype.bindAll(e.$keyboardNavigation.HeaderCell.prototype.keys);
    }
    function event$1(e) {
      e.$keyboardNavigation.Event = function(a) {
        if (this.eventId = null, e.getEvent(a)) {
          var t = e.getEvent(a);
          this.start = new Date(t.start_date), this.end = new Date(t.end_date), this.section = this._getSection(t), this.eventId = a;
        }
      }, e.$keyboardNavigation.Event.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { _getNodes: function() {
        return Array.prototype.slice.call(e.$container.querySelectorAll("[" + e.config.event_attribute + "]"));
      }, _modes: e.$keyboardNavigation.SchedulerNode.prototype._modes, getMode: e.$keyboardNavigation.SchedulerNode.prototype.getMode, _handlers: null, isValid: function() {
        return !(!e.getEvent(this.eventId) || !this.getNode());
      }, fallback: function() {
        var a = this._getNodes()[0], t = null;
        if (a && e._locate_event(a)) {
          var n = e._locate_event(a);
          t = new e.$keyboardNavigation.Event(n);
        } else
          t = new e.$keyboardNavigation.TimeSlot();
        return t;
      }, isScrolledIntoView: function(a) {
        var t = a.getBoundingClientRect(), n = e.$container.querySelector(".dhx_cal_data").getBoundingClientRect();
        return !(t.bottom < n.top || t.top > n.bottom);
      }, getNode: function() {
        var a = "[" + e.config.event_attribute + "='" + this.eventId + "']", t = e.$keyboardNavigation.dispatcher.getInlineEditor(this.eventId);
        if (t)
          return t;
        if (e.isMultisectionEvent && e.isMultisectionEvent(e.getEvent(this.eventId))) {
          for (var n = e.$container.querySelectorAll(a), o = 0; o < n.length; o++)
            if (this.isScrolledIntoView(n[o]))
              return n[o];
          return n[0];
        }
        return e.$container.querySelector(a);
      }, focus: function() {
        var a = e.getEvent(this.eventId), t = e.getState();
        (a.start_date.valueOf() > t.max_date.valueOf() || a.end_date.valueOf() <= t.min_date.valueOf()) && e.setCurrentView(a.start_date);
        var n = this.getNode();
        this.isScrolledIntoView(n) ? e.$keyboardNavigation.dispatcher.keepScrollPosition((function() {
          e.$keyboardNavigation.KeyNavNode.prototype.focus.apply(this);
        }).bind(this)) : e.$keyboardNavigation.KeyNavNode.prototype.focus.apply(this);
      }, blur: function() {
        e.$keyboardNavigation.KeyNavNode.prototype.blur.apply(this);
      }, _getSection: function(a) {
        var t = null, n = e.getState().mode;
        return e.matrix && e.matrix[n] ? t = a[e.matrix[e.getState().mode].y_property] : e._props && e._props[n] && (t = a[e._props[n].map_to]), t;
      }, _moveToSlot: function(a) {
        var t = e.getEvent(this.eventId);
        if (t) {
          var n = this._getSection(t), o = new e.$keyboardNavigation.TimeSlot(t.start_date, null, n);
          this.moveTo(o.nextSlot(o, a));
        } else
          this.moveTo(new e.$keyboardNavigation.TimeSlot());
      }, keys: { left: function() {
        this._moveToSlot("left");
      }, right: function() {
        this._moveToSlot("right");
      }, down: function() {
        this.getMode() == this._modes.list ? e.$keyboardNavigation.SchedulerNode.prototype.nextEventHandler() : this._moveToSlot("down");
      }, space: function() {
        var a = this.getNode();
        a && a.click ? a.click() : this.moveTo(new e.$keyboardNavigation.TimeSlot());
      }, up: function() {
        this.getMode() == this._modes.list ? e.$keyboardNavigation.SchedulerNode.prototype.prevEventHandler() : this._moveToSlot("up");
      }, delete: function() {
        e.getEvent(this.eventId) ? e._click.buttons.delete(this.eventId) : this.moveTo(new e.$keyboardNavigation.TimeSlot());
      }, enter: function() {
        e.getEvent(this.eventId) ? e.showLightbox(this.eventId) : this.moveTo(new e.$keyboardNavigation.TimeSlot());
      } } }), e.$keyboardNavigation.Event.prototype.bindAll(e.$keyboardNavigation.Event.prototype.keys);
    }
    function time_slot(e) {
      e.$keyboardNavigation.TimeSlot = function(a, t, n, o) {
        var r = e.getState(), d = e.matrix && e.matrix[r.mode];
        a || (a = this.getDefaultDate()), t || (t = d ? e.date.add(a, d.x_step, d.x_unit) : e.date.add(a, e.config.key_nav_step, "minute")), this.section = n || this._getDefaultSection(), this.start_date = new Date(a), this.end_date = new Date(t), this.movingDate = o || null;
      }, e.$keyboardNavigation.TimeSlot.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { _handlers: null, getDefaultDate: function() {
        var a, t = e.getState(), n = new Date(t.date);
        n.setSeconds(0), n.setMilliseconds(0);
        var o = /* @__PURE__ */ new Date();
        o.setSeconds(0), o.setMilliseconds(0);
        var r = e.matrix && e.matrix[t.mode], d = !1;
        if (n.valueOf() === o.valueOf() && (d = !0), r)
          d ? (r.x_unit === "day" ? (o.setHours(0), o.setMinutes(0)) : r.x_unit === "hour" && o.setMinutes(0), a = o) : a = e.date[r.name + "_start"](new Date(t.date)), a = this.findVisibleColumn(a);
        else if (a = new Date(e.getState().min_date), d && (a = o), a = this.findVisibleColumn(a), d || a.setHours(e.config.first_hour), !e._table_view) {
          var i = e.$container.querySelector(".dhx_cal_data");
          i.scrollTop && a.setHours(e.config.first_hour + Math.ceil(i.scrollTop / e.config.hour_size_px));
        }
        return a;
      }, clone: function(a) {
        return new e.$keyboardNavigation.TimeSlot(a.start_date, a.end_date, a.section, a.movingDate);
      }, _getMultisectionView: function() {
        var a, t = e.getState();
        return e._props && e._props[t.mode] ? a = e._props[t.mode] : e.matrix && e.matrix[t.mode] && (a = e.matrix[t.mode]), a;
      }, _getDefaultSection: function() {
        var a = null;
        return this._getMultisectionView() && !a && (a = this._getNextSection()), a;
      }, _getNextSection: function(a, t) {
        var n = this._getMultisectionView(), o = n.order[a], r = o;
        (r = o !== void 0 ? o + t : n.size && n.position ? n.position : 0) < 0 && (r = 0);
        var d = n.options || n.y_unit;
        return r >= d.length && (r = d.length - 1), d[r] ? d[r].key : null;
      }, isValid: function() {
        var a = e.getState();
        if (this.start_date.valueOf() < a.min_date.valueOf() || this.start_date.valueOf() >= a.max_date.valueOf() || !this.isVisible(this.start_date, this.end_date))
          return !1;
        var t = this._getMultisectionView();
        return !t || t.order[this.section] !== void 0;
      }, fallback: function() {
        var a = new e.$keyboardNavigation.TimeSlot();
        return a.isValid() ? a : new e.$keyboardNavigation.DataArea();
      }, getNodes: function() {
        return Array.prototype.slice.call(e.$container.querySelectorAll(".dhx_focus_slot"));
      }, getNode: function() {
        return this.getNodes()[0];
      }, focus: function() {
        this.section && e.getView() && e.getView().smart_rendering && e.getView().scrollTo && !e.$container.querySelector(`[data-section-id="${this.section}"]`) && e.getView().scrollTo({ section: this.section }), e.$keyboardNavigation.marker.render(this.start_date, this.end_date, this.section), e.$keyboardNavigation.KeyNavNode.prototype.focus.apply(this), e.$keyboardNavigation._pasteDate = this.start_date, e.$keyboardNavigation._pasteSection = this.section;
      }, blur: function() {
        e.$keyboardNavigation.KeyNavNode.prototype.blur.apply(this), e.$keyboardNavigation.marker.clear();
      }, _modes: e.$keyboardNavigation.SchedulerNode.prototype._modes, _getMode: e.$keyboardNavigation.SchedulerNode.prototype.getMode, addMonthDate: function(a, t, n) {
        var o;
        switch (t) {
          case "up":
            o = e.date.add(a, -1, "week");
            break;
          case "down":
            o = e.date.add(a, 1, "week");
            break;
          case "left":
            o = e.date.day_start(e.date.add(a, -1, "day")), o = this.findVisibleColumn(o, -1);
            break;
          case "right":
            o = e.date.day_start(e.date.add(a, 1, "day")), o = this.findVisibleColumn(o, 1);
            break;
          default:
            o = e.date.day_start(new Date(a));
        }
        var r = e.getState();
        return (a.valueOf() < r.min_date.valueOf() || !n && a.valueOf() >= r.max_date.valueOf()) && (o = new Date(r.min_date)), o;
      }, nextMonthSlot: function(a, t, n) {
        var o, r;
        return (o = this.addMonthDate(a.start_date, t, n)).setHours(e.config.first_hour), (r = new Date(o)).setHours(e.config.last_hour), { start_date: o, end_date: r };
      }, _alignTimeSlot: function(a, t, n, o) {
        for (var r = new Date(t); r.valueOf() < a.valueOf(); )
          r = e.date.add(r, o, n);
        return r.valueOf() > a.valueOf() && (r = e.date.add(r, -o, n)), r;
      }, nextTimelineSlot: function(a, t, n) {
        var o = e.getState(), r = e.matrix[o.mode], d = this._alignTimeSlot(a.start_date, e.date[r.name + "_start"](new Date(a.start_date)), r.x_unit, r.x_step), i = this._alignTimeSlot(a.end_date, e.date[r.name + "_start"](new Date(a.end_date)), r.x_unit, r.x_step);
        i.valueOf() <= d.valueOf() && (i = e.date.add(d, r.x_step, r.x_unit));
        var s = this.clone(a);
        switch (s.start_date = d, s.end_date = i, s.section = a.section || this._getNextSection(), t) {
          case "up":
            s.section = this._getNextSection(a.section, -1);
            break;
          case "down":
            s.section = this._getNextSection(a.section, 1);
            break;
          case "left":
            s.start_date = this.findVisibleColumn(e.date.add(s.start_date, -r.x_step, r.x_unit), -1), s.end_date = e.date.add(s.start_date, r.x_step, r.x_unit);
            break;
          case "right":
            s.start_date = this.findVisibleColumn(e.date.add(s.start_date, r.x_step, r.x_unit), 1), s.end_date = e.date.add(s.start_date, r.x_step, r.x_unit);
        }
        return (s.start_date.valueOf() < o.min_date.valueOf() || s.start_date.valueOf() >= o.max_date.valueOf()) && (n && s.start_date.valueOf() >= o.max_date.valueOf() ? s.start_date = new Date(o.max_date) : (s.start_date = e.date[o.mode + "_start"](e.date.add(o.date, t == "left" ? -1 : 1, o.mode)), s.end_date = e.date.add(s.start_date, r.x_step, r.x_unit))), s;
      }, nextUnitsSlot: function(a, t, n) {
        var o = this.clone(a);
        o.section = a.section || this._getNextSection();
        var r = a.section || this._getNextSection(), d = e.getState(), i = e._props[d.mode];
        switch (t) {
          case "left":
            r = this._getNextSection(a.section, -1);
            var s = i.size ? i.size - 1 : i.options.length;
            i.days > 1 && i.order[r] == s - 1 && e.date.add(a.start_date, -1, "day").valueOf() >= d.min_date.valueOf() && (o = this.nextDaySlot(a, t, n));
            break;
          case "right":
            r = this._getNextSection(a.section, 1), i.days > 1 && !i.order[r] && e.date.add(a.start_date, 1, "day").valueOf() < d.max_date.valueOf() && (o = this.nextDaySlot(a, t, n));
            break;
          default:
            o = this.nextDaySlot(a, t, n), r = a.section;
        }
        return o.section = r, o;
      }, _moveDate: function(a, t) {
        var n = this.findVisibleColumn(e.date.add(a, t, "day"), t);
        return n.setHours(a.getHours()), n.setMinutes(a.getMinutes()), n;
      }, isBeforeLastHour: function(a, t) {
        var n = a.getMinutes(), o = a.getHours(), r = e.config.last_hour;
        return o < r || !t && (r == 24 || o == r) && !n;
      }, isAfterFirstHour: function(a, t) {
        var n = a.getMinutes(), o = a.getHours(), r = e.config.first_hour, d = e.config.last_hour;
        return o >= r || !t && !n && (!o && d == 24 || o == d);
      }, isInVisibleDayTime: function(a, t) {
        return this.isBeforeLastHour(a, t) && this.isAfterFirstHour(a, t);
      }, nextDaySlot: function(a, t, n) {
        var o, r, d = e.config.key_nav_step, i = this._alignTimeSlot(a.start_date, e.date.day_start(new Date(a.start_date)), "minute", d), s = a.start_date;
        switch (t) {
          case "up":
            if (o = e.date.add(i, -d, "minute"), !this.isInVisibleDayTime(o, !0) && (!n || this.isInVisibleDayTime(s, !0))) {
              var _ = !0;
              n && e.date.date_part(new Date(o)).valueOf() != e.date.date_part(new Date(s)).valueOf() && (_ = !1), _ && (o = this.findVisibleColumn(e.date.add(a.start_date, -1, "day"), -1)), o.setHours(e.config.last_hour), o.setMinutes(0), o = e.date.add(o, -d, "minute");
            }
            r = e.date.add(o, d, "minute");
            break;
          case "down":
            o = e.date.add(i, d, "minute");
            var l = n ? o : e.date.add(o, d, "minute");
            !this.isInVisibleDayTime(l, !1) && (!n || this.isInVisibleDayTime(s, !1)) && (n ? (_ = !0, e.date.date_part(new Date(s)).valueOf() == s.valueOf() && (_ = !1), _ && (o = this.findVisibleColumn(e.date.add(a.start_date, 1, "day"), 1)), o.setHours(e.config.first_hour), o.setMinutes(0), o = e.date.add(o, d, "minute")) : ((o = this.findVisibleColumn(e.date.add(a.start_date, 1, "day"), 1)).setHours(e.config.first_hour), o.setMinutes(0))), r = e.date.add(o, d, "minute");
            break;
          case "left":
            o = this._moveDate(a.start_date, -1), r = this._moveDate(a.end_date, -1);
            break;
          case "right":
            o = this._moveDate(a.start_date, 1), r = this._moveDate(a.end_date, 1);
            break;
          default:
            o = i, r = e.date.add(o, d, "minute");
        }
        return { start_date: o, end_date: r };
      }, nextWeekAgendaSlot: function(a, t) {
        var n, o, r = e.getState();
        switch (t) {
          case "down":
          case "left":
            n = e.date.day_start(e.date.add(a.start_date, -1, "day")), n = this.findVisibleColumn(n, -1);
            break;
          case "up":
          case "right":
            n = e.date.day_start(e.date.add(a.start_date, 1, "day")), n = this.findVisibleColumn(n, 1);
            break;
          default:
            n = e.date.day_start(a.start_date);
        }
        return (a.start_date.valueOf() < r.min_date.valueOf() || a.start_date.valueOf() >= r.max_date.valueOf()) && (n = new Date(r.min_date)), (o = new Date(n)).setHours(e.config.last_hour), { start_date: n, end_date: o };
      }, nextAgendaSlot: function(a, t) {
        return { start_date: a.start_date, end_date: a.end_date };
      }, isDateVisible: function(a) {
        if (!e._ignores_detected)
          return !0;
        var t, n = e.matrix && e.matrix[e.getState().mode];
        return t = n ? e._get_date_index(n, a) : e.locate_holder_day(a), !e._ignores[t];
      }, findVisibleColumn: function(a, t) {
        var n = a;
        t = t || 1;
        for (var o = e.getState(); !this.isDateVisible(n) && (t > 0 && n.valueOf() <= o.max_date.valueOf() || t < 0 && n.valueOf() >= o.min_date.valueOf()); )
          n = this.nextDateColumn(n, t);
        return n;
      }, nextDateColumn: function(a, t) {
        t = t || 1;
        var n = e.matrix && e.matrix[e.getState().mode];
        return n ? e.date.add(a, t * n.x_step, n.x_unit) : e.date.day_start(e.date.add(a, t, "day"));
      }, isVisible: function(a, t) {
        if (!e._ignores_detected)
          return !0;
        for (var n = new Date(a); n.valueOf() < t.valueOf(); ) {
          if (this.isDateVisible(n))
            return !0;
          n = this.nextDateColumn(n);
        }
        return !1;
      }, nextSlot: function(a, t, n, o) {
        var r;
        n = n || this._getMode();
        var d = e.$keyboardNavigation.TimeSlot.prototype.clone(a);
        switch (n) {
          case this._modes.units:
            r = this.nextUnitsSlot(d, t, o);
            break;
          case this._modes.timeline:
            r = this.nextTimelineSlot(d, t, o);
            break;
          case this._modes.year:
          case this._modes.month:
            r = this.nextMonthSlot(d, t, o);
            break;
          case this._modes.weekAgenda:
            r = this.nextWeekAgendaSlot(d, t, o);
            break;
          case this._modes.list:
            r = this.nextAgendaSlot(d, t, o);
            break;
          case this._modes.dayColumns:
            r = this.nextDaySlot(d, t, o);
        }
        return r.start_date.valueOf() >= r.end_date.valueOf() && (r = this.nextSlot(r, t, n)), e.$keyboardNavigation.TimeSlot.prototype.clone(r);
      }, extendSlot: function(a, t) {
        var n;
        switch (this._getMode()) {
          case this._modes.units:
            n = t == "left" || t == "right" ? this.nextUnitsSlot(a, t) : this.extendUnitsSlot(a, t);
            break;
          case this._modes.timeline:
            n = t == "down" || t == "up" ? this.nextTimelineSlot(a, t) : this.extendTimelineSlot(a, t);
            break;
          case this._modes.year:
          case this._modes.month:
            n = this.extendMonthSlot(a, t);
            break;
          case this._modes.dayColumns:
            n = this.extendDaySlot(a, t);
            break;
          case this._modes.weekAgenda:
            n = this.extendWeekAgendaSlot(a, t);
            break;
          default:
            n = a;
        }
        var o = e.getState();
        return n.start_date.valueOf() < o.min_date.valueOf() && (n.start_date = this.findVisibleColumn(o.min_date), n.start_date.setHours(e.config.first_hour)), n.end_date.valueOf() > o.max_date.valueOf() && (n.end_date = this.findVisibleColumn(o.max_date, -1)), e.$keyboardNavigation.TimeSlot.prototype.clone(n);
      }, extendTimelineSlot: function(a, t) {
        return this.extendGenericSlot({ left: "start_date", right: "end_date" }, a, t, "timeline");
      }, extendWeekAgendaSlot: function(a, t) {
        return this.extendGenericSlot({ left: "start_date", right: "end_date" }, a, t, "weekAgenda");
      }, extendGenericSlot: function(a, t, n, o) {
        var r, d = t.movingDate;
        if (d || (d = a[n]), !d || !a[n])
          return t;
        if (!n)
          return e.$keyboardNavigation.TimeSlot.prototype.clone(t);
        (r = this.nextSlot({ start_date: t[d], section: t.section }, n, o, !0)).start_date.valueOf() == t.start_date.valueOf() && (r = this.nextSlot({ start_date: r.start_date, section: r.section }, n, o, !0)), r.movingDate = d;
        var i = this.extendSlotDates(t, r, r.movingDate);
        return i.end_date.valueOf() <= i.start_date.valueOf() && (r.movingDate = r.movingDate == "end_date" ? "start_date" : "end_date"), i = this.extendSlotDates(t, r, r.movingDate), r.start_date = i.start_date, r.end_date = i.end_date, r;
      }, extendSlotDates: function(a, t, n) {
        var o = { start_date: null, end_date: null };
        return n == "start_date" ? (o.start_date = t.start_date, o.end_date = a.end_date) : (o.start_date = a.start_date, o.end_date = t.start_date), o;
      }, extendMonthSlot: function(a, t) {
        return (a = this.extendGenericSlot({ up: "start_date", down: "end_date", left: "start_date", right: "end_date" }, a, t, "month")).start_date.setHours(e.config.first_hour), a.end_date = e.date.add(a.end_date, -1, "day"), a.end_date.setHours(e.config.last_hour), a;
      }, extendUnitsSlot: function(a, t) {
        var n;
        switch (t) {
          case "down":
          case "up":
            n = this.extendDaySlot(a, t);
            break;
          default:
            n = a;
        }
        return n.section = a.section, n;
      }, extendDaySlot: function(a, t) {
        return this.extendGenericSlot({ up: "start_date", down: "end_date", left: "start_date", right: "end_date" }, a, t, "dayColumns");
      }, scrollSlot: function(a) {
        var t = e.getState(), n = this.nextSlot(this, a);
        (n.start_date.valueOf() < t.min_date.valueOf() || n.start_date.valueOf() >= t.max_date.valueOf()) && e.setCurrentView(new Date(n.start_date)), this.moveTo(n);
      }, keys: { left: function() {
        this.scrollSlot("left");
      }, right: function() {
        this.scrollSlot("right");
      }, down: function() {
        this._getMode() == this._modes.list ? e.$keyboardNavigation.SchedulerNode.prototype.nextEventHandler() : this.scrollSlot("down");
      }, up: function() {
        this._getMode() == this._modes.list ? e.$keyboardNavigation.SchedulerNode.prototype.prevEventHandler() : this.scrollSlot("up");
      }, "shift+down": function() {
        this.moveTo(this.extendSlot(this, "down"));
      }, "shift+up": function() {
        this.moveTo(this.extendSlot(this, "up"));
      }, "shift+right": function() {
        this.moveTo(this.extendSlot(this, "right"));
      }, "shift+left": function() {
        this.moveTo(this.extendSlot(this, "left"));
      }, enter: function() {
        var a = { start_date: new Date(this.start_date), end_date: new Date(this.end_date) }, t = e.getState().mode;
        e.matrix && e.matrix[t] ? a[e.matrix[e.getState().mode].y_property] = this.section : e._props && e._props[t] && (a[e._props[t].map_to] = this.section), e.addEventNow(a);
      } } }), e.$keyboardNavigation.TimeSlot.prototype.bindAll(e.$keyboardNavigation.TimeSlot.prototype.keys);
    }
    function minical_button(e) {
      e.$keyboardNavigation.MinicalButton = function(a, t) {
        this.container = a, this.index = t || 0;
      }, e.$keyboardNavigation.MinicalButton.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { isValid: function() {
        return !!this.container.offsetWidth;
      }, fallback: function() {
        var a = new e.$keyboardNavigation.TimeSlot();
        return a.isValid() ? a : new e.$keyboardNavigation.DataArea();
      }, focus: function() {
        e.$keyboardNavigation.dispatcher.globalNode.disable(), this.container.removeAttribute("tabindex"), e.$keyboardNavigation.KeyNavNode.prototype.focus.apply(this);
      }, blur: function() {
        this.container.setAttribute("tabindex", "0"), e.$keyboardNavigation.KeyNavNode.prototype.blur.apply(this);
      }, getNode: function() {
        return this.index ? this.container.querySelector(".dhx_cal_next_button") : this.container.querySelector(".dhx_cal_prev_button");
      }, keys: { right: function(a) {
        this.moveTo(new e.$keyboardNavigation.MinicalButton(this.container, this.index ? 0 : 1));
      }, left: function(a) {
        this.moveTo(new e.$keyboardNavigation.MinicalButton(this.container, this.index ? 0 : 1));
      }, down: function() {
        var a = new e.$keyboardNavigation.MinicalCell(this.container, 0, 0);
        a && !a.isValid() && (a = a.fallback()), this.moveTo(a);
      }, enter: function(a) {
        this.getNode().click();
      } } }), e.$keyboardNavigation.MinicalButton.prototype.bindAll(e.$keyboardNavigation.MinicalButton.prototype.keys);
    }
    function minical_cell(e) {
      e.$keyboardNavigation.MinicalCell = function(a, t, n) {
        this.container = a, this.row = t || 0, this.col = n || 0;
      }, e.$keyboardNavigation.MinicalCell.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { isValid: function() {
        var a = this._getGrid();
        return !(!a[this.row] || !a[this.row][this.col]);
      }, fallback: function() {
        var a = this.row, t = this.col, n = this._getGrid();
        n[a] || (a = 0);
        var o = !0;
        if (a > n.length / 2 && (o = !1), !n[a]) {
          var r = new e.$keyboardNavigation.TimeSlot();
          return r.isValid() ? r : new e.$keyboardNavigation.DataArea();
        }
        if (o) {
          for (var d = t; n[a] && d < n[a].length; d++)
            if (n[a][d] || d != n[a].length - 1 || (a++, t = 0), n[a][d])
              return new e.$keyboardNavigation.MinicalCell(this.container, a, d);
        } else
          for (d = t; n[a] && d < n[a].length; d--)
            if (n[a][d] || d || (t = n[--a].length - 1), n[a][d])
              return new e.$keyboardNavigation.MinicalCell(this.container, a, d);
        return new e.$keyboardNavigation.MinicalButton(this.container, 0);
      }, focus: function() {
        e.$keyboardNavigation.dispatcher.globalNode.disable(), this.container.removeAttribute("tabindex"), e.$keyboardNavigation.KeyNavNode.prototype.focus.apply(this);
      }, blur: function() {
        this.container.setAttribute("tabindex", "0"), e.$keyboardNavigation.KeyNavNode.prototype.blur.apply(this);
      }, _getNode: function(a, t) {
        return this.container.querySelector(".dhx_year_body tr:nth-child(" + (a + 1) + ") td:nth-child(" + (t + 1) + ")");
      }, getNode: function() {
        return this._getNode(this.row, this.col);
      }, _getGrid: function() {
        for (var a = this.container.querySelectorAll(".dhx_year_body tr"), t = [], n = 0; n < a.length; n++) {
          t[n] = [];
          for (var o = a[n].querySelectorAll("td"), r = 0; r < o.length; r++) {
            var d = o[r], i = !0, s = e._getClassName(d);
            (s.indexOf("dhx_after") > -1 || s.indexOf("dhx_before") > -1 || s.indexOf("dhx_scale_ignore") > -1) && (i = !1), t[n][r] = i;
          }
        }
        return t;
      }, keys: { right: function(a) {
        var t = this._getGrid(), n = this.row, o = this.col + 1;
        t[n] && t[n][o] || (t[n + 1] ? (n += 1, o = 0) : o = this.col);
        var r = new e.$keyboardNavigation.MinicalCell(this.container, n, o);
        r.isValid() || (r = r.fallback()), this.moveTo(r);
      }, left: function(a) {
        var t = this._getGrid(), n = this.row, o = this.col - 1;
        t[n] && t[n][o] || (o = t[n - 1] ? t[n -= 1].length - 1 : this.col);
        var r = new e.$keyboardNavigation.MinicalCell(this.container, n, o);
        r.isValid() || (r = r.fallback()), this.moveTo(r);
      }, down: function() {
        var a = this._getGrid(), t = this.row + 1, n = this.col;
        a[t] && a[t][n] || (t = this.row);
        var o = new e.$keyboardNavigation.MinicalCell(this.container, t, n);
        o.isValid() || (o = o.fallback()), this.moveTo(o);
      }, up: function() {
        var a = this._getGrid(), t = this.row - 1, n = this.col;
        if (a[t] && a[t][n]) {
          var o = new e.$keyboardNavigation.MinicalCell(this.container, t, n);
          o.isValid() || (o = o.fallback()), this.moveTo(o);
        } else {
          var r = 0;
          this.col > a[this.row].length / 2 && (r = 1), this.moveTo(new e.$keyboardNavigation.MinicalButton(this.container, r));
        }
      }, enter: function(a) {
        this.getNode().querySelector(".dhx_month_head").click();
      } } }), e.$keyboardNavigation.MinicalCell.prototype.bindAll(e.$keyboardNavigation.MinicalCell.prototype.keys);
    }
    function data_area(e) {
      e.$keyboardNavigation.DataArea = function(a) {
        this.index = a || 0;
      }, e.$keyboardNavigation.DataArea.prototype = e._compose(e.$keyboardNavigation.KeyNavNode, { getNode: function(a) {
        return e.$container.querySelector(".dhx_cal_data");
      }, _handlers: null, isValid: function() {
        return !0;
      }, fallback: function() {
        return this;
      }, keys: { "up,down,right,left": function() {
        this.moveTo(new e.$keyboardNavigation.TimeSlot());
      } } }), e.$keyboardNavigation.DataArea.prototype.bindAll(e.$keyboardNavigation.DataArea.prototype.keys);
    }
    function modals(e) {
      (function() {
        var a = [];
        function t() {
          return !!a.length;
        }
        function n(i) {
          setTimeout(function() {
            if (e.$destroyed)
              return !0;
            t() || function(s, _) {
              for (; s && s != _; )
                s = s.parentNode;
              return s == _;
            }(document.activeElement, e.$container) || e.focus();
          }, 1);
        }
        function o(i) {
          var s = (i = i || window.event).currentTarget;
          s == a[a.length - 1] && e.$keyboardNavigation.trapFocus(s, i);
        }
        if (e.attachEvent("onLightbox", function() {
          var i;
          i = e.getLightbox(), e.eventRemove(i, "keydown", o), e.event(i, "keydown", o), a.push(i);
        }), e.attachEvent("onAfterLightbox", function() {
          var i = a.pop();
          i && e.eventRemove(i, "keydown", o), n();
        }), e.attachEvent("onAfterQuickInfo", function() {
          n();
        }), !e._keyNavMessagePopup) {
          e._keyNavMessagePopup = !0;
          var r = null, d = null;
          const i = [];
          e.attachEvent("onMessagePopup", function(s) {
            for (r = document.activeElement, d = r; d && e._getClassName(d).indexOf("dhx_cal_data") < 0; )
              d = d.parentNode;
            d && (d = d.parentNode), e.eventRemove(s, "keydown", o), e.event(s, "keydown", o), i.push(s);
          }), e.attachEvent("onAfterMessagePopup", function() {
            var s = i.pop();
            s && e.eventRemove(s, "keydown", o), setTimeout(function() {
              if (e.$destroyed)
                return !0;
              for (var _ = document.activeElement; _ && e._getClassName(_).indexOf("dhx_cal_light") < 0; )
                _ = _.parentNode;
              _ || (r && r.parentNode ? r.focus() : d && d.parentNode && d.focus(), r = null, d = null);
            }, 1);
          });
        }
        e.$keyboardNavigation.isModal = t;
      })();
    }
    function core(e) {
      e.$keyboardNavigation.dispatcher = { isActive: !1, activeNode: null, globalNode: new e.$keyboardNavigation.SchedulerNode(), keepScrollPosition: function(a) {
        var t, n, o = e.$container.querySelector(".dhx_timeline_scrollable_data");
        o || (o = e.$container.querySelector(".dhx_cal_data")), o && (t = o.scrollTop, n = o.scrollLeft), a(), o && (o.scrollTop = t, o.scrollLeft = n);
      }, enable: function() {
        if (e.$container) {
          this.isActive = !0;
          var a = this;
          this.keepScrollPosition(function() {
            a.globalNode.enable(), a.setActiveNode(a.getActiveNode());
          });
        }
      }, disable: function() {
        this.isActive = !1, this.globalNode.disable();
      }, isEnabled: function() {
        return !!this.isActive;
      }, getDefaultNode: function() {
        return this.globalNode.getDefaultNode();
      }, setDefaultNode: function() {
        this.setActiveNode(this.getDefaultNode());
      }, getActiveNode: function() {
        var a = this.activeNode;
        return a && !a.isValid() && (a = a.fallback()), a;
      }, focusGlobalNode: function() {
        this.blurNode(this.globalNode), this.focusNode(this.globalNode);
      }, setActiveNode: function(a) {
        a && a.isValid() && (this.activeNode && this.activeNode.compareTo(a) || this.isEnabled() && (this.blurNode(this.activeNode), this.activeNode = a, this.focusNode(this.activeNode)));
      }, focusNode: function(a) {
        a && a.focus && (a.focus(), a.getNode && document.activeElement != a.getNode() && this.setActiveNode(new e.$keyboardNavigation.DataArea()));
      }, blurNode: function(a) {
        a && a.blur && a.blur();
      }, getInlineEditor: function(a) {
        var t = e.$container.querySelector(".dhx_cal_editor[" + e.config.event_attribute + "='" + a + "'] textarea");
        return t && t.offsetWidth ? t : null;
      }, keyDownHandler: function(a) {
        if (!a.defaultPrevented) {
          var t = this.getActiveNode();
          if ((!e.$keyboardNavigation.isModal() || t && t.container && e.utils.dom.locateCss({ target: t.container }, "dhx_minical_popup", !1)) && (!e.getState().editor_id || !this.getInlineEditor(e.getState().editor_id)) && this.isEnabled()) {
            a = a || window.event;
            var n = this.globalNode, o = e.$keyboardNavigation.shortcuts.getCommandFromEvent(a);
            t ? t.findHandler(o) ? t.doAction(o, a) : n.findHandler(o) && n.doAction(o, a) : this.setDefaultNode();
          }
        }
      }, _timeout: null, delay: function(a, t) {
        clearTimeout(this._timeout), this._timeout = setTimeout(a, t || 1);
      } };
    }
    function key_nav_legacy(e) {
      e._temp_key_scope = function() {
        e.config.key_nav = !0, e.$keyboardNavigation._pasteDate = null, e.$keyboardNavigation._pasteSection = null;
        var a = null, t = {};
        function n(d) {
          d = d || window.event, t.x = d.clientX, t.y = d.clientY;
        }
        function o() {
          for (var d, i, s = document.elementFromPoint(t.x, t.y); s && s != e._obj; )
            s = s.parentNode;
          return d = s == e._obj, i = e.$keyboardNavigation.dispatcher.isEnabled(), d || i;
        }
        function r(d) {
          return e._lame_copy({}, d);
        }
        document.body ? e.event(document.body, "mousemove", n) : e.event(window, "load", function() {
          e.event(document.body, "mousemove", n);
        }), e.attachEvent("onMouseMove", function(d, i) {
          var s = e.getState();
          if (s.mode && s.min_date) {
            var _ = e.getActionData(i);
            e.$keyboardNavigation._pasteDate = _.date, e.$keyboardNavigation._pasteSection = _.section;
          }
        }), e._make_pasted_event = function(d) {
          var i = e.$keyboardNavigation._pasteDate, s = e.$keyboardNavigation._pasteSection, _ = d.end_date - d.start_date, l = r(d);
          if (function(u) {
            delete u.rec_type, delete u.rec_pattern, delete u.event_pid, delete u.event_length;
          }(l), l.start_date = new Date(i), l.end_date = new Date(l.start_date.valueOf() + _), s) {
            var h = e._get_section_property();
            e.config.multisection ? l[h] = d[h] : l[h] = s;
          }
          return l;
        }, e._do_paste = function(d, i, s) {
          e.callEvent("onBeforeEventPasted", [d, i, s]) !== !1 && (e.addEvent(i), e.callEvent("onEventPasted", [d, i, s]));
        }, e._is_key_nav_active = function() {
          return !(!this._is_initialized() || this._is_lightbox_open() || !this.config.key_nav);
        }, e.event(document, "keydown", function(d) {
          (d.ctrlKey || d.metaKey) && d.keyCode == 86 && e._buffer_event && !e.$keyboardNavigation.dispatcher.isEnabled() && (e.$keyboardNavigation.dispatcher.isActive = o());
        }), e._key_nav_copy_paste = function(d) {
          if (!e._is_key_nav_active())
            return !0;
          if (d.keyCode == 37 || d.keyCode == 39) {
            d.cancelBubble = !0;
            var i = e.date.add(e._date, d.keyCode == 37 ? -1 : 1, e._mode);
            return e.setCurrentView(i), !0;
          }
          var s, _ = (s = e.$keyboardNavigation.dispatcher.getActiveNode()) && s.eventId ? s.eventId : e._select_id;
          if ((d.ctrlKey || d.metaKey) && d.keyCode == 67)
            return _ && (e._buffer_event = r(e.getEvent(_)), a = !0, e.callEvent("onEventCopied", [e.getEvent(_)])), !0;
          if ((d.ctrlKey || d.metaKey) && d.keyCode == 88 && _) {
            a = !1;
            var l = e._buffer_event = r(e.getEvent(_));
            e.updateEvent(l.id), e.callEvent("onEventCut", [l]);
          }
          if ((d.ctrlKey || d.metaKey) && d.keyCode == 86 && o()) {
            if (l = (l = e._buffer_event ? e.getEvent(e._buffer_event.id) : e._buffer_event) || e._buffer_event) {
              var h = e._make_pasted_event(l);
              a ? (h.id = e.uid(), e._do_paste(a, h, l)) : e.callEvent("onBeforeEventChanged", [h, d, !1, l]) && (e._do_paste(a, h, l), a = !0);
            }
            return !0;
          }
        };
      }, e._temp_key_scope();
    }
    function scheduler_handlers(e) {
      e.$keyboardNavigation.attachSchedulerHandlers = function() {
        var a, t = e.$keyboardNavigation.dispatcher, n = function(s) {
          if (e.config.key_nav)
            return t.keyDownHandler(s);
        }, o = function() {
          t.keepScrollPosition(function() {
            t.focusGlobalNode();
          });
        };
        e.attachEvent("onDataRender", function() {
          e.config.key_nav && t.isEnabled() && !e.getState().editor_id && (clearTimeout(a), a = setTimeout(function() {
            if (e.$destroyed)
              return !0;
            t.isEnabled() || t.enable(), r();
          }));
        });
        var r = function() {
          if (t.isEnabled()) {
            var s = t.getActiveNode();
            s && (s.isValid() || (s = s.fallback()), !s || s instanceof e.$keyboardNavigation.MinicalButton || s instanceof e.$keyboardNavigation.MinicalCell || t.keepScrollPosition(function() {
              s.focus(!0);
            }));
          }
        };
        function d(s) {
          if (!e.config.key_nav)
            return !0;
          var _, l = e.$keyboardNavigation.isChildOf(s.target || s.srcElement, e.$container.querySelector(".dhx_cal_data")), h = e.getActionData(s);
          e._locate_event(s.target || s.srcElement) ? _ = new e.$keyboardNavigation.Event(e._locate_event(s.target || s.srcElement)) : l && (_ = new e.$keyboardNavigation.TimeSlot(), h.date && l && (_ = _.nextSlot(new e.$keyboardNavigation.TimeSlot(h.date, null, h.section)))), _ && (t.isEnabled() ? h.date && l && t.delay(function() {
            t.setActiveNode(_);
          }) : t.activeNode = _);
        }
        e.attachEvent("onSchedulerReady", function() {
          var s = e.$container;
          e.eventRemove(document, "keydown", n), e.eventRemove(s, "mousedown", d), e.eventRemove(s, "focus", o), e.config.key_nav ? (e.event(document, "keydown", n), e.event(s, "mousedown", d), e.event(s, "focus", o), s.setAttribute("tabindex", "0")) : s.removeAttribute("tabindex");
        });
        var i = e.updateEvent;
        e.updateEvent = function(s) {
          var _ = i.apply(this, arguments);
          if (e.config.key_nav && t.isEnabled() && e.getState().select_id == s) {
            var l = new e.$keyboardNavigation.Event(s);
            e.getState().lightbox_id || function(h) {
              if (e.config.key_nav && t.isEnabled()) {
                var u = h, m = new e.$keyboardNavigation.Event(u.eventId);
                if (!m.isValid()) {
                  var f = m.start || u.start, y = m.end || u.end, b = m.section || u.section;
                  (m = new e.$keyboardNavigation.TimeSlot(f, y, b)).isValid() || (m = new e.$keyboardNavigation.TimeSlot());
                }
                t.setActiveNode(m);
                var c = t.getActiveNode();
                c && c.getNode && document.activeElement != c.getNode() && t.focusNode(t.getActiveNode());
              }
            }(l);
          }
          return _;
        }, e.attachEvent("onEventDeleted", function(s) {
          return e.config.key_nav && t.isEnabled() && t.getActiveNode().eventId == s && t.setActiveNode(new e.$keyboardNavigation.TimeSlot()), !0;
        }), e.attachEvent("onClearAll", function() {
          if (!e.config.key_nav)
            return !0;
          t.isEnabled() && t.getActiveNode() instanceof e.$keyboardNavigation.Event && t.setActiveNode(new e.$keyboardNavigation.TimeSlot());
        });
      };
    }
    function minical_handlers(e) {
      e.$keyboardNavigation._minicalendars = [], e.$keyboardNavigation.isMinical = function(a) {
        for (var t = e.$keyboardNavigation._minicalendars, n = 0; n < t.length; n++)
          if (this.isChildOf(a, t[n]))
            return !0;
        return !1;
      }, e.$keyboardNavigation.isChildOf = function(a, t) {
        for (; a && a !== t; )
          a = a.parentNode;
        return a === t;
      }, e.$keyboardNavigation.patchMinicalendar = function() {
        var a = e.$keyboardNavigation.dispatcher;
        function t(d) {
          var i = d.target;
          a.enable(), a.setActiveNode(new e.$keyboardNavigation.MinicalButton(i, 0));
        }
        function n(d) {
          var i = d.target || d.srcElement, s = e.utils.dom.locateCss(d, "dhx_cal_prev_button", !1), _ = e.utils.dom.locateCss(d, "dhx_cal_next_button", !1), l = e.utils.dom.locateCss(d, "dhx_year_body", !1), h = 0, u = 0;
          if (l) {
            for (var m, f, y = i; y && y.tagName.toLowerCase() != "td"; )
              y = y.parentNode;
            if (y && (m = (f = y).parentNode), m && f) {
              for (var b = m.parentNode.querySelectorAll("tr"), c = 0; c < b.length; c++)
                if (b[c] == m) {
                  h = c;
                  break;
                }
              var g = m.querySelectorAll("td");
              for (c = 0; c < g.length; c++)
                if (g[c] == f) {
                  u = c;
                  break;
                }
            }
          }
          var v = d.currentTarget;
          a.delay(function() {
            var p;
            (s || _ || l) && (s ? (p = new e.$keyboardNavigation.MinicalButton(v, 0), a.setActiveNode(new e.$keyboardNavigation.MinicalButton(v, 0))) : _ ? p = new e.$keyboardNavigation.MinicalButton(v, 1) : l && (p = new e.$keyboardNavigation.MinicalCell(v, h, u)), p && (a.enable(), p.isValid() && (a.activeNode = null, a.setActiveNode(p))));
          });
        }
        if (e.renderCalendar) {
          var o = e.renderCalendar;
          e.renderCalendar = function() {
            var d = o.apply(this, arguments), i = e.$keyboardNavigation._minicalendars;
            e.eventRemove(d, "click", n), e.event(d, "click", n), e.eventRemove(d, "focus", t), e.event(d, "focus", t);
            for (var s = !1, _ = 0; _ < i.length; _++)
              if (i[_] == d) {
                s = !0;
                break;
              }
            if (s || i.push(d), a.isEnabled()) {
              var l = a.getActiveNode();
              l && l.container == d ? a.focusNode(l) : d.setAttribute("tabindex", "0");
            } else
              d.setAttribute("tabindex", "0");
            return d;
          };
        }
        if (e.destroyCalendar) {
          var r = e.destroyCalendar;
          e.destroyCalendar = function(d, i) {
            d = d || (e._def_count ? e._def_count.firstChild : null);
            var s = r.apply(this, arguments);
            if (!d || !d.parentNode)
              for (var _ = e.$keyboardNavigation._minicalendars, l = 0; l < _.length; l++)
                _[l] == d && (e.eventRemove(_[l], "focus", t), _.splice(l, 1), l--);
            return s;
          };
        }
      };
    }
    function key_nav(e) {
      function a(t) {
        var n = { minicalButton: e.$keyboardNavigation.MinicalButton, minicalDate: e.$keyboardNavigation.MinicalCell, scheduler: e.$keyboardNavigation.SchedulerNode, dataArea: e.$keyboardNavigation.DataArea, timeSlot: e.$keyboardNavigation.TimeSlot, event: e.$keyboardNavigation.Event }, o = {};
        for (var r in n)
          o[r.toLowerCase()] = n[r];
        return o[t = (t + "").toLowerCase()] || n.scheduler;
      }
      e.config.key_nav = !0, e.config.key_nav_step = 30, e.addShortcut = function(t, n, o) {
        var r = a(o);
        r && r.prototype.bind(t, n);
      }, e.getShortcutHandler = function(t, n) {
        var o = a(n);
        if (o) {
          var r = e.$keyboardNavigation.shortcuts.parse(t);
          if (r.length)
            return o.prototype.findHandler(r[0]);
        }
      }, e.removeShortcut = function(t, n) {
        var o = a(n);
        o && o.prototype.unbind(t);
      }, e.focus = function() {
        if (e.config.key_nav) {
          var t = e.$keyboardNavigation.dispatcher;
          t.enable();
          var n = t.getActiveNode();
          !n || n instanceof e.$keyboardNavigation.MinicalButton || n instanceof e.$keyboardNavigation.MinicalCell ? t.setDefaultNode() : t.focusNode(t.getActiveNode());
        }
      }, e.$keyboardNavigation = {}, e._compose = function() {
        for (var t = Array.prototype.slice.call(arguments, 0), n = {}, o = 0; o < t.length; o++) {
          var r = t[o];
          for (var d in typeof r == "function" && (r = new r()), r)
            n[d] = r[d];
        }
        return n;
      }, keyboard_shortcuts(e), eventhandler(e), trap_modal_focus(e), marker(e), scheduler_node(e), nav_node(e), header_cell(e), event$1(e), time_slot(e), minical_button(e), minical_cell(e), data_area(e), modals(e), core(e), key_nav_legacy(e), function() {
        scheduler_handlers(e), minical_handlers(e);
        var t = e.$keyboardNavigation.dispatcher;
        if (e.$keyboardNavigation.attachSchedulerHandlers(), e.renderCalendar)
          e.$keyboardNavigation.patchMinicalendar();
        else
          var n = e.attachEvent("onSchedulerReady", function() {
            e.detachEvent(n), e.$keyboardNavigation.patchMinicalendar();
          });
        function o() {
          if (e.config.key_nav) {
            var i = document.activeElement;
            return !(!i || e.utils.dom.locateCss(i, "dhx_cal_quick_info", !1)) && (e.$keyboardNavigation.isChildOf(i, e.$container) || e.$keyboardNavigation.isMinical(i));
          }
        }
        function r(i) {
          i && !t.isEnabled() ? t.enable() : !i && t.isEnabled() && t.disable();
        }
        const d = setInterval(function() {
          if (e.$container && e.$keyboardNavigation.isChildOf(e.$container, document.body)) {
            var i = o();
            i ? r(i) : !i && t.isEnabled() && setTimeout(function() {
              e.$destroyed || (e.config.key_nav ? r(o()) : e.$container.removeAttribute("tabindex"));
            }, 100);
          }
        }, 500);
        e.attachEvent("onDestroy", function() {
          clearInterval(d);
        });
      }();
    }
    function layer(e) {
      e.attachEvent("onTemplatesReady", function() {
        this.layers.sort(function(t, n) {
          return t.zIndex - n.zIndex;
        }), e._dp_init = function(t) {
          t._methods = ["_set_event_text_style", "", "changeEventId", "deleteEvent"], this.attachEvent("onEventAdded", function(n) {
            !this._loading && this.validId(n) && this.getEvent(n) && this.getEvent(n).layer == t.layer && t.setUpdated(n, !0, "inserted");
          }), this.attachEvent("onBeforeEventDelete", function(n) {
            if (this.getEvent(n) && this.getEvent(n).layer == t.layer) {
              if (!this.validId(n))
                return;
              var o = t.getState(n);
              return o == "inserted" || this._new_event ? (t.setUpdated(n, !1), !0) : o != "deleted" && (o == "true_deleted" || (t.setUpdated(n, !0, "deleted"), !1));
            }
            return !0;
          }), this.attachEvent("onEventChanged", function(n) {
            !this._loading && this.validId(n) && this.getEvent(n) && this.getEvent(n).layer == t.layer && t.setUpdated(n, !0, "updated");
          }), t._getRowData = function(n, o) {
            var r = this.obj.getEvent(n), d = {};
            for (var i in r)
              i.indexOf("_") !== 0 && (r[i] && r[i].getUTCFullYear ? d[i] = this.obj._helpers.formatDate(r[i]) : d[i] = r[i]);
            return d;
          }, t._clearUpdateFlag = function() {
          }, t.attachEvent("insertCallback", e._update_callback), t.attachEvent("updateCallback", e._update_callback), t.attachEvent("deleteCallback", function(n, o) {
            this.obj.setUserData(o, this.action_param, "true_deleted"), this.obj.deleteEvent(o);
          });
        }, function() {
          var t = function(r) {
            if (r === null || typeof r != "object")
              return r;
            var d = new r.constructor();
            for (var i in r)
              d[i] = t(r[i]);
            return d;
          };
          e._dataprocessors = [], e._layers_zindex = {};
          for (var n = 0; n < e.layers.length; n++) {
            if (e.config["lightbox_" + e.layers[n].name] = {}, e.config["lightbox_" + e.layers[n].name].sections = t(e.config.lightbox.sections), e._layers_zindex[e.layers[n].name] = e.config.initial_layer_zindex || 5 + 3 * n, e.layers[n].url) {
              var o = e.createDataProcessor({ url: e.layers[n].url });
              o.layer = e.layers[n].name, e._dataprocessors.push(o), e._dataprocessors[n].init(e);
            }
            e.layers[n].isDefault && (e.defaultLayer = e.layers[n].name);
          }
        }(), e.showLayer = function(t) {
          this.toggleLayer(t, !0);
        }, e.hideLayer = function(t) {
          this.toggleLayer(t, !1);
        }, e.toggleLayer = function(t, n) {
          var o = this.getLayer(t);
          o.visible = n !== void 0 ? !!n : !o.visible, this.setCurrentView(this._date, this._mode);
        }, e.getLayer = function(t) {
          var n, o;
          typeof t == "string" && (o = t), typeof t == "object" && (o = t.layer);
          for (var r = 0; r < e.layers.length; r++)
            e.layers[r].name == o && (n = e.layers[r]);
          return n;
        }, e.attachEvent("onBeforeLightbox", function(t) {
          var n = this.getEvent(t);
          return this.config.lightbox.sections = this.config["lightbox_" + n.layer].sections, e.resetLightbox(), !0;
        }), e.attachEvent("onClick", function(t, n) {
          var o = e.getEvent(t);
          return !e.getLayer(o.layer).noMenu;
        }), e.attachEvent("onEventCollision", function(t, n) {
          var o = this.getLayer(t);
          if (!o.checkCollision)
            return !1;
          for (var r = 0, d = 0; d < n.length; d++)
            n[d].layer == o.name && n[d].id != t.id && r++;
          return r >= e.config.collision_limit;
        }), e.addEvent = function(t, n, o, r, d) {
          var i = t;
          arguments.length != 1 && ((i = d || {}).start_date = t, i.end_date = n, i.text = o, i.id = r, i.layer = this.defaultLayer), i.id = i.id || e.uid(), i.text = i.text || "", typeof i.start_date == "string" && (i.start_date = this.templates.api_date(i.start_date)), typeof i.end_date == "string" && (i.end_date = this.templates.api_date(i.end_date)), i._timed = this.isOneDayEvent(i);
          var s = !this._events[i.id];
          this._events[i.id] = i, this.event_updated(i), this._loading || this.callEvent(s ? "onEventAdded" : "onEventChanged", [i.id, i]);
        }, this._evs_layer = {};
        for (var a = 0; a < this.layers.length; a++)
          this._evs_layer[this.layers[a].name] = [];
        e.addEventNow = function(t, n, o) {
          var r = {};
          typeof t == "object" && (r = t, t = null);
          var d = 6e4 * (this.config.event_duration || this.config.time_step);
          t || (t = Math.round(e._currentDate().valueOf() / d) * d);
          var i = new Date(t);
          if (!n) {
            var s = this.config.first_hour;
            s > i.getHours() && (i.setHours(s), t = i.valueOf()), n = t + d;
          }
          r.start_date = r.start_date || i, r.end_date = r.end_date || new Date(n), r.text = r.text || this.locale.labels.new_event, r.id = this._drag_id = this.uid(), r.layer = this.defaultLayer, this._drag_mode = "new-size", this._loading = !0, this.addEvent(r), this.callEvent("onEventCreated", [this._drag_id, o]), this._loading = !1, this._drag_event = {}, this._on_mouse_up(o);
        }, e._t_render_view_data = function(t) {
          if (this.config.multi_day && !this._table_view) {
            for (var n = [], o = [], r = 0; r < t.length; r++)
              t[r]._timed ? n.push(t[r]) : o.push(t[r]);
            this._table_view = !0, this.render_data(o), this._table_view = !1, this.render_data(n);
          } else
            this.render_data(t);
        }, e.render_view_data = function() {
          if (this._not_render)
            this._render_wait = !0;
          else {
            this._render_wait = !1, this.clear_view(), this._evs_layer = {};
            for (var t = 0; t < this.layers.length; t++)
              this._evs_layer[this.layers[t].name] = [];
            var n = this.get_visible_events();
            for (t = 0; t < n.length; t++)
              this._evs_layer[n[t].layer] && this._evs_layer[n[t].layer].push(n[t]);
            if (this._mode == "month") {
              var o = [];
              for (t = 0; t < this.layers.length; t++)
                this.layers[t].visible && (o = o.concat(this._evs_layer[this.layers[t].name]));
              this._t_render_view_data(o);
            } else
              for (t = 0; t < this.layers.length; t++)
                if (this.layers[t].visible) {
                  var r = this._evs_layer[this.layers[t].name];
                  this._t_render_view_data(r);
                }
          }
        }, e._render_v_bar = function(t, n, o, r, d, i, s, _, l) {
          var h = t.id;
          s.indexOf("<div class=") == -1 && (s = e.templates["event_header_" + t.layer] ? e.templates["event_header_" + t.layer](t.start_date, t.end_date, t) : s), _.indexOf("<div class=") == -1 && (_ = e.templates["event_text_" + t.layer] ? e.templates["event_text_" + t.layer](t.start_date, t.end_date, t) : _);
          var u = document.createElement("div"), m = "dhx_cal_event", f = e.templates["event_class_" + t.layer] ? e.templates["event_class_" + t.layer](t.start_date, t.end_date, t) : e.templates.event_class(t.start_date, t.end_date, t);
          f && (m = m + " " + f);
          var y = e._border_box_events(), b = r - 2, c = y ? b : r - 4, g = y ? b : r - 6, v = y ? b : r - 14, p = y ? b - 2 : r - 8, x = y ? d - this.xy.event_header_height : d - 30 + 1, w = '<div event_id="' + h + '" ' + e.config.event_attribute + '="' + h + '" class="' + m + '" style="position:absolute; top:' + o + "px; left:" + n + "px; width:" + c + "px; height:" + d + "px;" + (i || "") + '">';
          return w += '<div class="dhx_header" style=" width:' + g + 'px;" >&nbsp;</div>', w += '<div class="dhx_title">' + s + "</div>", w += '<div class="dhx_body" style=" width:' + v + "px; height:" + x + 'px;">' + _ + "</div>", w += '<div class="dhx_footer" style=" width:' + p + "px;" + (l ? " margin-top:-1px;" : "") + '" ></div></div>', u.innerHTML = w, u.style.zIndex = 100, u.firstChild;
        }, e.render_event_bar = function(t) {
          var n = this._els.dhx_cal_data[0], o = this._colsS[t._sday], r = this._colsS[t._eday];
          r == o && (r = this._colsS[t._eday + 1]);
          var d = this.xy.bar_height, i = this._colsS.heights[t._sweek] + (this._colsS.height ? this.xy.month_scale_height + 2 : 2) + t._sorder * d, s = document.createElement("div"), _ = t._timed ? "dhx_cal_event_clear" : "dhx_cal_event_line", l = e.templates["event_class_" + t.layer] ? e.templates["event_class_" + t.layer](t.start_date, t.end_date, t) : e.templates.event_class(t.start_date, t.end_date, t);
          l && (_ = _ + " " + l);
          var h = '<div event_id="' + t.id + '" ' + this.config.event_attribute + '="' + t.id + '" class="' + _ + '" style="position:absolute; top:' + i + "px; left:" + o + "px; width:" + (r - o - 15) + "px;" + (t._text_style || "") + '">';
          t._timed && (h += e.templates["event_bar_date_" + t.layer] ? e.templates["event_bar_date_" + t.layer](t.start_date, t.end_date, t) : e.templates.event_bar_date(t.start_date, t.end_date, t)), h += e.templates["event_bar_text_" + t.layer] ? e.templates["event_bar_text_" + t.layer](t.start_date, t.end_date, t) : e.templates.event_bar_text(t.start_date, t.end_date, t) + "</div>)", h += "</div>", s.innerHTML = h, this._rendered.push(s.firstChild), n.appendChild(s.firstChild);
        }, e.render_event = function(t) {
          var n = e.xy.menu_width;
          if (e.getLayer(t.layer).noMenu && (n = 0), !(t._sday < 0)) {
            var o = e.locate_holder(t._sday);
            if (o) {
              var r = 60 * t.start_date.getHours() + t.start_date.getMinutes(), d = 60 * t.end_date.getHours() + t.end_date.getMinutes() || 60 * e.config.last_hour, i = Math.round((60 * r * 1e3 - 60 * this.config.first_hour * 60 * 1e3) * this.config.hour_size_px / 36e5) % (24 * this.config.hour_size_px) + 1, s = Math.max(e.xy.min_event_height, (d - r) * this.config.hour_size_px / 60) + 1, _ = Math.floor((o.clientWidth - n) / t._count), l = t._sorder * _ + 1;
              t._inner || (_ *= t._count - t._sorder);
              var h = this._render_v_bar(t.id, n + l, i, _, s, t._text_style, e.templates.event_header(t.start_date, t.end_date, t), e.templates.event_text(t.start_date, t.end_date, t));
              if (this._rendered.push(h), o.appendChild(h), l = l + parseInt(o.style.left, 10) + n, i += this._dy_shift, h.style.zIndex = this._layers_zindex[t.layer], this._edit_id == t.id) {
                h.style.zIndex = parseInt(h.style.zIndex) + 1;
                var u = h.style.zIndex;
                _ = Math.max(_ - 4, e.xy.editor_width), (h = document.createElement("div")).setAttribute("event_id", t.id), h.setAttribute(this.config.event_attribute, t.id), this.set_xy(h, _, s - 20, l, i + 14), h.className = "dhx_cal_editor", h.style.zIndex = u;
                var m = document.createElement("div");
                this.set_xy(m, _ - 6, s - 26), m.style.cssText += ";margin:2px 2px 2px 2px;overflow:hidden;", m.style.zIndex = u, h.appendChild(m), this._els.dhx_cal_data[0].appendChild(h), this._rendered.push(h), m.innerHTML = "<textarea class='dhx_cal_editor'>" + t.text + "</textarea>", this._editor = m.firstChild, this._editor.addEventListener("keypress", function(g) {
                  if (g.shiftKey)
                    return !0;
                  var v = g.keyCode;
                  v == e.keys.edit_save && e.editStop(!0), v == e.keys.edit_cancel && e.editStop(!1);
                }), this._editor.addEventListener("selectstart", function(g) {
                  return g.cancelBubble = !0, !0;
                }), m.firstChild.focus(), this._els.dhx_cal_data[0].scrollLeft = 0, m.firstChild.select();
              }
              if (this._select_id == t.id) {
                h.style.zIndex = parseInt(h.style.zIndex) + 1;
                for (var f = this.config["icons_" + (this._edit_id == t.id ? "edit" : "select")], y = "", b = 0; b < f.length; b++)
                  y += "<div class='dhx_menu_icon " + f[b] + "' title='" + this.locale.labels[f[b]] + "'></div>";
                var c = this._render_v_bar(t.id, l - n + 1, i, n, 20 * f.length + 26, "", "<div class='dhx_menu_head'></div>", y, !0);
                c.style.left = l - n + 1, c.style.zIndex = h.style.zIndex, this._els.dhx_cal_data[0].appendChild(c), this._rendered.push(c);
              }
            }
          }
        }, e.filter_agenda = function(t, n) {
          var o = e.getLayer(n.layer);
          return o && o.visible;
        };
      });
    }
    function dhtmlxError$1(e, a, t) {
      return this.catches || (this.catches = []), this;
    }
    function extend() {
      global$1.dhtmlx || (global$1.dhtmlx = function(e) {
        for (var a in e)
          dhtmlx[a] = e[a];
        return dhtmlx;
      });
      let dhtmlx = global$1.dhtmlx;
      function dtmlXMLLoaderObject(e, a, t, n) {
        return this.xmlDoc = "", this.async = t === void 0 || t, this.onloadAction = e || null, this.mainObject = a || null, this.waitCall = null, this.rSeed = n || !1, this;
      }
      function dhtmlDragAndDropObject() {
        return global$1.dhtmlDragAndDrop ? global$1.dhtmlDragAndDrop : (this.lastLanding = 0, this.dragNode = 0, this.dragStartNode = 0, this.dragStartObject = 0, this.tempDOMU = null, this.tempDOMM = null, this.waitDrag = 0, global$1.dhtmlDragAndDrop = this, this);
      }
      dhtmlx.extend_api = function(e, a, t) {
        var n = global$1[e];
        n && (global$1[e] = function(o) {
          var r;
          if (o && typeof o == "object" && !o.tagName) {
            for (var d in r = n.apply(this, a._init ? a._init(o) : arguments), dhtmlx)
              a[d] && this[a[d]](dhtmlx[d]);
            for (var d in o)
              a[d] ? this[a[d]](o[d]) : d.indexOf("on") === 0 && this.attachEvent(d, o[d]);
          } else
            r = n.apply(this, arguments);
          return a._patch && a._patch(this), r || this;
        }, global$1[e].prototype = n.prototype, t && dhtmlXHeir(global$1[e].prototype, t));
      }, global$1.dhtmlxAjax = { get: function(e, a) {
        var t = new dtmlXMLLoaderObject(!0);
        return t.async = arguments.length < 3, t.waitCall = a, t.loadXML(e), t;
      }, post: function(e, a, t) {
        var n = new dtmlXMLLoaderObject(!0);
        return n.async = arguments.length < 4, n.waitCall = t, n.loadXML(e, !0, a), n;
      }, getSync: function(e) {
        return this.get(e, null, !0);
      }, postSync: function(e, a) {
        return this.post(e, a, null, !0);
      } }, global$1.dtmlXMLLoaderObject = dtmlXMLLoaderObject, dtmlXMLLoaderObject.count = 0, dtmlXMLLoaderObject.prototype.waitLoadFunction = function(e) {
        var a = !0;
        return this.check = function() {
          if (e && e.onloadAction && (!e.xmlDoc.readyState || e.xmlDoc.readyState == 4)) {
            if (!a)
              return;
            a = !1, dtmlXMLLoaderObject.count++, typeof e.onloadAction == "function" && e.onloadAction(e.mainObject, null, null, null, e), e.waitCall && (e.waitCall.call(this, e), e.waitCall = null);
          }
        }, this.check;
      }, dtmlXMLLoaderObject.prototype.getXMLTopNode = function(e, a) {
        var t;
        if (this.xmlDoc.responseXML) {
          if ((n = this.xmlDoc.responseXML.getElementsByTagName(e)).length === 0 && e.indexOf(":") != -1)
            var n = this.xmlDoc.responseXML.getElementsByTagName(e.split(":")[1]);
          t = n[0];
        } else
          t = this.xmlDoc.documentElement;
        return t ? (this._retry = !1, t) : !this._retry && _isIE ? (this._retry = !0, a = this.xmlDoc, this.loadXMLString(this.xmlDoc.responseText.replace(/^[\s]+/, ""), !0), this.getXMLTopNode(e, a)) : (dhtmlxError.throwError("LoadXML", "Incorrect XML", [a || this.xmlDoc, this.mainObject]), document.createElement("div"));
      }, dtmlXMLLoaderObject.prototype.loadXMLString = function(e, a) {
        if (_isIE)
          this.xmlDoc = new ActiveXObject("Microsoft.XMLDOM"), this.xmlDoc.async = this.async, this.xmlDoc.onreadystatechange = function() {
          }, this.xmlDoc.loadXML(e);
        else {
          var t = new DOMParser();
          this.xmlDoc = t.parseFromString(e, "text/xml");
        }
        a || (this.onloadAction && this.onloadAction(this.mainObject, null, null, null, this), this.waitCall && (this.waitCall(), this.waitCall = null));
      }, dtmlXMLLoaderObject.prototype.loadXML = function(e, a, t, n) {
        this.rSeed && (e += (e.indexOf("?") != -1 ? "&" : "?") + "a_dhx_rSeed=" + (/* @__PURE__ */ new Date()).valueOf()), this.filePath = e, !_isIE && global$1.XMLHttpRequest ? this.xmlDoc = new XMLHttpRequest() : this.xmlDoc = new ActiveXObject("Microsoft.XMLHTTP"), this.async && (this.xmlDoc.onreadystatechange = new this.waitLoadFunction(this)), typeof a == "string" ? this.xmlDoc.open(a, e, this.async) : this.xmlDoc.open(a ? "POST" : "GET", e, this.async), n ? (this.xmlDoc.setRequestHeader("User-Agent", "dhtmlxRPC v0.1 (" + navigator.userAgent + ")"), this.xmlDoc.setRequestHeader("Content-type", "text/xml")) : a && this.xmlDoc.setRequestHeader("Content-type", "application/x-www-form-urlencoded"), this.xmlDoc.setRequestHeader("X-Requested-With", "XMLHttpRequest"), this.xmlDoc.send(t), this.async || new this.waitLoadFunction(this)();
      }, dtmlXMLLoaderObject.prototype.destructor = function() {
        return this._filterXPath = null, this._getAllNamedChilds = null, this._retry = null, this.async = null, this.rSeed = null, this.filePath = null, this.onloadAction = null, this.mainObject = null, this.xmlDoc = null, this.doXPath = null, this.doXPathOpera = null, this.doXSLTransToObject = null, this.doXSLTransToString = null, this.loadXML = null, this.loadXMLString = null, this.doSerialization = null, this.xmlNodeToJSON = null, this.getXMLTopNode = null, this.setXSLParamValue = null, null;
      }, dtmlXMLLoaderObject.prototype.xmlNodeToJSON = function(e) {
        for (var a = {}, t = 0; t < e.attributes.length; t++)
          a[e.attributes[t].name] = e.attributes[t].value;
        for (a._tagvalue = e.firstChild ? e.firstChild.nodeValue : "", t = 0; t < e.childNodes.length; t++) {
          var n = e.childNodes[t].tagName;
          n && (a[n] || (a[n] = []), a[n].push(this.xmlNodeToJSON(e.childNodes[t])));
        }
        return a;
      }, global$1.dhtmlDragAndDropObject = dhtmlDragAndDropObject, dhtmlDragAndDropObject.prototype.removeDraggableItem = function(e) {
        e.onmousedown = null, e.dragStarter = null, e.dragLanding = null;
      }, dhtmlDragAndDropObject.prototype.addDraggableItem = function(e, a) {
        e.onmousedown = this.preCreateDragCopy, e.dragStarter = a, this.addDragLanding(e, a);
      }, dhtmlDragAndDropObject.prototype.addDragLanding = function(e, a) {
        e.dragLanding = a;
      }, dhtmlDragAndDropObject.prototype.preCreateDragCopy = function(e) {
        if (!e && !global$1.event || (e || event).button != 2)
          return global$1.dhtmlDragAndDrop.waitDrag ? (global$1.dhtmlDragAndDrop.waitDrag = 0, document.body.onmouseup = global$1.dhtmlDragAndDrop.tempDOMU, document.body.onmousemove = global$1.dhtmlDragAndDrop.tempDOMM, !1) : (global$1.dhtmlDragAndDrop.dragNode && global$1.dhtmlDragAndDrop.stopDrag(e), global$1.dhtmlDragAndDrop.waitDrag = 1, global$1.dhtmlDragAndDrop.tempDOMU = document.body.onmouseup, global$1.dhtmlDragAndDrop.tempDOMM = document.body.onmousemove, global$1.dhtmlDragAndDrop.dragStartNode = this, global$1.dhtmlDragAndDrop.dragStartObject = this.dragStarter, document.body.onmouseup = global$1.dhtmlDragAndDrop.preCreateDragCopy, document.body.onmousemove = global$1.dhtmlDragAndDrop.callDrag, global$1.dhtmlDragAndDrop.downtime = (/* @__PURE__ */ new Date()).valueOf(), !(!e || !e.preventDefault) && (e.preventDefault(), !1));
      }, dhtmlDragAndDropObject.prototype.callDrag = function(e) {
        e || (e = global$1.event);
        var a = global$1.dhtmlDragAndDrop;
        if (!((/* @__PURE__ */ new Date()).valueOf() - a.downtime < 100)) {
          if (!a.dragNode) {
            if (!a.waitDrag)
              return a.stopDrag(e, !0);
            if (a.dragNode = a.dragStartObject._createDragNode(a.dragStartNode, e), !a.dragNode)
              return a.stopDrag();
            a.dragNode.onselectstart = function() {
              return !1;
            }, a.gldragNode = a.dragNode, document.body.appendChild(a.dragNode), document.body.onmouseup = a.stopDrag, a.waitDrag = 0, a.dragNode.pWindow = global$1, a.initFrameRoute();
          }
          if (a.dragNode.parentNode != global$1.document.body && a.gldragNode) {
            var t = a.gldragNode;
            a.gldragNode.old && (t = a.gldragNode.old), t.parentNode.removeChild(t);
            var n = a.dragNode.pWindow;
            if (t.pWindow && t.pWindow.dhtmlDragAndDrop.lastLanding && t.pWindow.dhtmlDragAndDrop.lastLanding.dragLanding._dragOut(t.pWindow.dhtmlDragAndDrop.lastLanding), _isIE) {
              var o = document.createElement("div");
              o.innerHTML = a.dragNode.outerHTML, a.dragNode = o.childNodes[0];
            } else
              a.dragNode = a.dragNode.cloneNode(!0);
            a.dragNode.pWindow = global$1, a.gldragNode.old = a.dragNode, document.body.appendChild(a.dragNode), n.dhtmlDragAndDrop.dragNode = a.dragNode;
          }
          var r;
          a.dragNode.style.left = e.clientX + 15 + (a.fx ? -1 * a.fx : 0) + (document.body.scrollLeft || document.documentElement.scrollLeft) + "px", a.dragNode.style.top = e.clientY + 3 + (a.fy ? -1 * a.fy : 0) + (document.body.scrollTop || document.documentElement.scrollTop) + "px", r = e.srcElement ? e.srcElement : e.target, a.checkLanding(r, e);
        }
      }, dhtmlDragAndDropObject.prototype.calculateFramePosition = function(e) {
        if (global$1.name) {
          for (var a = parent.frames[global$1.name].frameElement.offsetParent, t = 0, n = 0; a; )
            t += a.offsetLeft, n += a.offsetTop, a = a.offsetParent;
          if (parent.dhtmlDragAndDrop) {
            var o = parent.dhtmlDragAndDrop.calculateFramePosition(1);
            t += 1 * o.split("_")[0], n += 1 * o.split("_")[1];
          }
          if (e)
            return t + "_" + n;
          this.fx = t, this.fy = n;
        }
        return "0_0";
      }, dhtmlDragAndDropObject.prototype.checkLanding = function(e, a) {
        e && e.dragLanding ? (this.lastLanding && this.lastLanding.dragLanding._dragOut(this.lastLanding), this.lastLanding = e, this.lastLanding = this.lastLanding.dragLanding._dragIn(this.lastLanding, this.dragStartNode, a.clientX, a.clientY, a), this.lastLanding_scr = _isIE ? a.srcElement : a.target) : e && e.tagName != "BODY" ? this.checkLanding(e.parentNode, a) : (this.lastLanding && this.lastLanding.dragLanding._dragOut(this.lastLanding, a.clientX, a.clientY, a), this.lastLanding = 0, this._onNotFound && this._onNotFound());
      }, dhtmlDragAndDropObject.prototype.stopDrag = function(e, a) {
        var t = global$1.dhtmlDragAndDrop;
        if (!a) {
          t.stopFrameRoute();
          var n = t.lastLanding;
          t.lastLanding = null, n && n.dragLanding._drag(t.dragStartNode, t.dragStartObject, n, _isIE ? event.srcElement : e.target);
        }
        t.lastLanding = null, t.dragNode && t.dragNode.parentNode == document.body && t.dragNode.parentNode.removeChild(t.dragNode), t.dragNode = 0, t.gldragNode = 0, t.fx = 0, t.fy = 0, t.dragStartNode = 0, t.dragStartObject = 0, document.body.onmouseup = t.tempDOMU, document.body.onmousemove = t.tempDOMM, t.tempDOMU = null, t.tempDOMM = null, t.waitDrag = 0;
      }, dhtmlDragAndDropObject.prototype.stopFrameRoute = function(e) {
        e && global$1.dhtmlDragAndDrop.stopDrag(1, 1);
        for (var a = 0; a < global$1.frames.length; a++)
          try {
            global$1.frames[a] != e && global$1.frames[a].dhtmlDragAndDrop && global$1.frames[a].dhtmlDragAndDrop.stopFrameRoute(global$1);
          } catch {
          }
        try {
          parent.dhtmlDragAndDrop && parent != global$1 && parent != e && parent.dhtmlDragAndDrop.stopFrameRoute(global$1);
        } catch {
        }
      }, dhtmlDragAndDropObject.prototype.initFrameRoute = function(e, a) {
        e && (global$1.dhtmlDragAndDrop.preCreateDragCopy(), global$1.dhtmlDragAndDrop.dragStartNode = e.dhtmlDragAndDrop.dragStartNode, global$1.dhtmlDragAndDrop.dragStartObject = e.dhtmlDragAndDrop.dragStartObject, global$1.dhtmlDragAndDrop.dragNode = e.dhtmlDragAndDrop.dragNode, global$1.dhtmlDragAndDrop.gldragNode = e.dhtmlDragAndDrop.dragNode, global$1.document.body.onmouseup = global$1.dhtmlDragAndDrop.stopDrag, global$1.waitDrag = 0, !_isIE && a && (!_isFF || _FFrv < 1.8) && global$1.dhtmlDragAndDrop.calculateFramePosition());
        try {
          parent.dhtmlDragAndDrop && parent != global$1 && parent != e && parent.dhtmlDragAndDrop.initFrameRoute(global$1);
        } catch {
        }
        for (var t = 0; t < global$1.frames.length; t++)
          try {
            global$1.frames[t] != e && global$1.frames[t].dhtmlDragAndDrop && global$1.frames[t].dhtmlDragAndDrop.initFrameRoute(global$1, !e || a ? 1 : 0);
          } catch {
          }
      };
      var _isFF = !1, _isIE = !1, _isKHTML = !1, _FFrv = !1, _KHTMLrv = !1;
      function dhtmlXHeir(e, a) {
        for (var t in a)
          typeof a[t] == "function" && (e[t] = a[t]);
        return e;
      }
      navigator.userAgent.indexOf("Macintosh"), navigator.userAgent.toLowerCase().indexOf("chrome"), navigator.userAgent.indexOf("Safari") != -1 || navigator.userAgent.indexOf("Konqueror") != -1 ? (_KHTMLrv = parseFloat(navigator.userAgent.substr(navigator.userAgent.indexOf("Safari") + 7, 5)), _KHTMLrv > 525 ? (_isFF = !0, _FFrv = 1.9) : _isKHTML = !0) : navigator.userAgent.indexOf("Opera") != -1 ? parseFloat(navigator.userAgent.substr(navigator.userAgent.indexOf("Opera") + 6, 3)) : navigator.appName.indexOf("Microsoft") != -1 ? (_isIE = !0, navigator.appVersion.indexOf("MSIE 8.0") == -1 && navigator.appVersion.indexOf("MSIE 9.0") == -1 && navigator.appVersion.indexOf("MSIE 10.0") == -1 || document.compatMode == "BackCompat" || (_isIE = 8)) : navigator.appName == "Netscape" && navigator.userAgent.indexOf("Trident") != -1 ? _isIE = 8 : (_isFF = !0, _FFrv = parseFloat(navigator.userAgent.split("rv:")[1])), dtmlXMLLoaderObject.prototype.doXPath = function(e, a, t, n) {
        if (_isKHTML || !_isIE && !global$1.XPathResult)
          return this.doXPathOpera(e, a);
        if (_isIE)
          return a || (a = this.xmlDoc.nodeName ? this.xmlDoc : this.xmlDoc.responseXML), a || dhtmlxError.throwError("LoadXML", "Incorrect XML", [a || this.xmlDoc, this.mainObject]), t && a.setProperty("SelectionNamespaces", "xmlns:xsl='" + t + "'"), n == "single" ? a.selectSingleNode(e) : a.selectNodes(e) || new Array(0);
        var o = a;
        a || (a = this.xmlDoc.nodeName ? this.xmlDoc : this.xmlDoc.responseXML), a || dhtmlxError.throwError("LoadXML", "Incorrect XML", [a || this.xmlDoc, this.mainObject]), a.nodeName.indexOf("document") != -1 ? o = a : (o = a, a = a.ownerDocument);
        var r = XPathResult.ANY_TYPE;
        n == "single" && (r = XPathResult.FIRST_ORDERED_NODE_TYPE);
        var d = [], i = a.evaluate(e, o, function(_) {
          return t;
        }, r, null);
        if (r == XPathResult.FIRST_ORDERED_NODE_TYPE)
          return i.singleNodeValue;
        for (var s = i.iterateNext(); s; )
          d[d.length] = s, s = i.iterateNext();
        return d;
      }, global$1.dhtmlxError = new dhtmlxError$1(), dtmlXMLLoaderObject.prototype.doXPathOpera = function(e, a) {
        var t = e.replace(/[\/]+/gi, "/").split("/"), n = null, o = 1;
        if (!t.length)
          return [];
        if (t[0] == ".")
          n = [a];
        else {
          if (t[0] !== "")
            return [];
          n = (this.xmlDoc.responseXML || this.xmlDoc).getElementsByTagName(t[o].replace(/\[[^\]]*\]/g, "")), o++;
        }
        for (; o < t.length; o++)
          n = this._getAllNamedChilds(n, t[o]);
        return t[o - 1].indexOf("[") != -1 && (n = this._filterXPath(n, t[o - 1])), n;
      }, dtmlXMLLoaderObject.prototype._filterXPath = function(e, a) {
        for (var t = [], n = (a = a.replace(/[^\[]*\[\@/g, "").replace(/[\[\]\@]*/g, ""), 0); n < e.length; n++)
          e[n].getAttribute(a) && (t[t.length] = e[n]);
        return t;
      }, dtmlXMLLoaderObject.prototype._getAllNamedChilds = function(e, a) {
        var t = [];
        _isKHTML && (a = a.toUpperCase());
        for (var n = 0; n < e.length; n++)
          for (var o = 0; o < e[n].childNodes.length; o++)
            _isKHTML ? e[n].childNodes[o].tagName && e[n].childNodes[o].tagName.toUpperCase() == a && (t[t.length] = e[n].childNodes[o]) : e[n].childNodes[o].tagName == a && (t[t.length] = e[n].childNodes[o]);
        return t;
      }, global$1.dhtmlxEvent === void 0 && (global$1.dhtmlxEvent = function(e, a, t) {
        e.addEventListener ? e.addEventListener(a, t, !1) : e.attachEvent && e.attachEvent("on" + a, t);
      }), dtmlXMLLoaderObject.prototype.xslDoc = null, dtmlXMLLoaderObject.prototype.setXSLParamValue = function(e, a, t) {
        t || (t = this.xslDoc), t.responseXML && (t = t.responseXML);
        var n = this.doXPath("/xsl:stylesheet/xsl:variable[@name='" + e + "']", t, "http://www.w3.org/1999/XSL/Transform", "single");
        n && (n.firstChild.nodeValue = a);
      }, dtmlXMLLoaderObject.prototype.doXSLTransToObject = function(e, a) {
        var t;
        if (e || (e = this.xslDoc), e.responseXML && (e = e.responseXML), a || (a = this.xmlDoc), a.responseXML && (a = a.responseXML), _isIE) {
          t = new ActiveXObject("Msxml2.DOMDocument.3.0");
          try {
            a.transformNodeToObject(e, t);
          } catch {
            t = a.transformNode(e);
          }
        } else
          this.XSLProcessor || (this.XSLProcessor = new XSLTProcessor(), this.XSLProcessor.importStylesheet(e)), t = this.XSLProcessor.transformToDocument(a);
        return t;
      }, dtmlXMLLoaderObject.prototype.doXSLTransToString = function(e, a) {
        var t = this.doXSLTransToObject(e, a);
        return typeof t == "string" ? t : this.doSerialization(t);
      }, dtmlXMLLoaderObject.prototype.doSerialization = function(e) {
        return e || (e = this.xmlDoc), e.responseXML && (e = e.responseXML), _isIE ? e.xml : new XMLSerializer().serializeToString(e);
      }, global$1.dhtmlxEventable = function(obj) {
        obj.attachEvent = function(e, a, t) {
          return this[e = "ev_" + e.toLowerCase()] || (this[e] = new this.eventCatcher(t || this)), e + ":" + this[e].addEvent(a);
        }, obj.callEvent = function(e, a) {
          return !this[e = "ev_" + e.toLowerCase()] || this[e].apply(this, a);
        }, obj.checkEvent = function(e) {
          return !!this["ev_" + e.toLowerCase()];
        }, obj.eventCatcher = function(obj) {
          var dhx_catch = [], z = function() {
            for (var e = !0, a = 0; a < dhx_catch.length; a++)
              if (dhx_catch[a]) {
                var t = dhx_catch[a].apply(obj, arguments);
                e = e && t;
              }
            return e;
          };
          return z.addEvent = function(ev) {
            return typeof ev != "function" && (ev = eval(ev)), !!ev && dhx_catch.push(ev) - 1;
          }, z.removeEvent = function(e) {
            dhx_catch[e] = null;
          }, z;
        }, obj.detachEvent = function(e) {
          if (e) {
            var a = e.split(":");
            this[a[0]].removeEvent(a[1]);
          }
        }, obj.detachAllEvents = function() {
          for (var e in this)
            e.indexOf("ev_") === 0 && (this.detachEvent(e), this[e] = null);
        }, obj = null;
      };
    }
    function legacy(e) {
      extend();
    }
    function limit(e) {
      e.config.limit_start = null, e.config.limit_end = null, e.config.limit_view = !1, e.config.check_limits = !0, e.config.mark_now = !0, e.config.display_marked_timespans = !0, e.config.overwrite_marked_timespans = !0, e._temp_limit_scope = function() {
        var a = null, t = "dhx_time_block", n = "default", o = function(i, s, _) {
          var l = typeof i == "object" ? i : { days: i };
          return l.type = t, l.css = "", s && (_ && (l.sections = _), l = function(h, u, m) {
            return u instanceof Date && m instanceof Date ? (h.start_date = u, h.end_date = m) : (h.days = u, h.zones = m), h;
          }(l, i, s)), l;
        };
        e.blockTime = function(i, s, _) {
          var l = o(i, s, _);
          return e.addMarkedTimespan(l);
        }, e.unblockTime = function(i, s, _) {
          var l = o(i, s = s || "fullday", _);
          return e.deleteMarkedTimespan(l);
        }, e.attachEvent("onBeforeViewChange", function(i, s, _, l) {
          function h(u, m) {
            var f = e.config.limit_start, y = e.config.limit_end, b = e.date.add(u, 1, m);
            return u.valueOf() > y.valueOf() || b <= f.valueOf();
          }
          return !e.config.limit_view || !h(l = l || s, _ = _ || i) || s.valueOf() == l.valueOf() || (setTimeout(function() {
            if (e.$destroyed)
              return !0;
            var u = h(s, _) ? e.config.limit_start : s;
            e.setCurrentView(h(u, _) ? null : u, _);
          }, 1), !1);
        }), e.checkInMarkedTimespan = function(i, s, _) {
          s = s || n;
          for (var l = !0, h = new Date(i.start_date.valueOf()), u = e.date.add(h, 1, "day"), m = e._marked_timespans; h < i.end_date; h = e.date.date_part(u), u = e.date.add(h, 1, "day")) {
            var f = +e.date.date_part(new Date(h)), y = d(i, m, h.getDay(), f, s);
            if (y)
              for (var b = 0; b < y.length; b += 2) {
                var c = e._get_zone_minutes(h), g = i.end_date > u || i.end_date.getDate() != h.getDate() ? 1440 : e._get_zone_minutes(i.end_date), v = y[b], p = y[b + 1];
                if (v < g && p > c && !(l = typeof _ == "function" && _(i, c, g, v, p)))
                  break;
              }
          }
          return !l;
        };
        var r = e.checkLimitViolation = function(i) {
          if (!i || !e.config.check_limits)
            return !0;
          var s = e, _ = s.config, l = [];
          if (i.rec_type)
            for (var h = e.getRecDates(i), u = 0; u < h.length; u++) {
              var m = e._copy_event(i);
              e._lame_copy(m, h[u]), l.push(m);
            }
          else
            l = [i];
          for (var f = !0, y = 0; y < l.length; y++) {
            var b = !0;
            (m = l[y])._timed = e.isOneDayEvent(m), (b = !_.limit_start || !_.limit_end || m.start_date.valueOf() >= _.limit_start.valueOf() && m.end_date.valueOf() <= _.limit_end.valueOf()) && (b = !e.checkInMarkedTimespan(m, t, function(c, g, v, p, x) {
              var w = !0;
              return g <= x && g >= p && ((x == 1440 || v <= x) && (w = !1), c._timed && s._drag_id && s._drag_mode == "new-size" ? (c.start_date.setHours(0), c.start_date.setMinutes(x)) : w = !1), (v >= p && v <= x || g < p && v > x) && (c._timed && s._drag_id && s._drag_mode == "new-size" ? (c.end_date.setHours(0), c.end_date.setMinutes(p)) : w = !1), w;
            })), b || (b = s.checkEvent("onLimitViolation") ? s.callEvent("onLimitViolation", [m.id, m]) : b), f = f && b;
          }
          return f || (s._drag_id = null, s._drag_mode = null), f;
        };
        function d(i, s, _, l, h) {
          var u = e, m = [], f = { _props: "map_to", matrix: "y_property" };
          for (var y in f) {
            var b = f[y];
            if (u[y])
              for (var c in u[y]) {
                var g = u[y][c][b];
                i[g] && (m = u._add_timespan_zones(m, e._get_blocked_zones(s[c], i[g], _, l, h)));
              }
          }
          return m = u._add_timespan_zones(m, e._get_blocked_zones(s, "global", _, l, h));
        }
        e._get_blocked_zones = function(i, s, _, l, h) {
          var u = [];
          if (i && i[s])
            for (var m = i[s], f = this._get_relevant_blocked_zones(_, l, m, h), y = 0; y < f.length; y++)
              u = this._add_timespan_zones(u, f[y].zones);
          return u;
        }, e._get_relevant_blocked_zones = function(i, s, _, l) {
          var h;
          return e.config.overwrite_marked_timespans ? h = _[s] && _[s][l] ? _[s][l] : _[i] && _[i][l] ? _[i][l] : [] : (h = [], _[s] && _[s][l] && (h = h.concat(_[s][l])), _[i] && _[i][l] && (h = h.concat(_[i][l]))), h;
        }, e.attachEvent("onMouseDown", function(i) {
          return i != t;
        }), e.attachEvent("onBeforeDrag", function(i) {
          return !i || r(e.getEvent(i));
        }), e.attachEvent("onClick", function(i, s) {
          return r(e.getEvent(i));
        }), e.attachEvent("onBeforeLightbox", function(i) {
          var s = e.getEvent(i);
          return a = [s.start_date, s.end_date], r(s);
        }), e.attachEvent("onEventSave", function(i, s, _) {
          if (!s.start_date || !s.end_date) {
            var l = e.getEvent(i);
            s.start_date = new Date(l.start_date), s.end_date = new Date(l.end_date);
          }
          if (s.rec_type) {
            var h = e._lame_clone(s);
            return e._roll_back_dates(h), r(h);
          }
          return r(s);
        }), e.attachEvent("onEventAdded", function(i) {
          if (!i)
            return !0;
          var s = e.getEvent(i);
          return !r(s) && e.config.limit_start && e.config.limit_end && (s.start_date < e.config.limit_start && (s.start_date = new Date(e.config.limit_start)), s.start_date.valueOf() >= e.config.limit_end.valueOf() && (s.start_date = this.date.add(e.config.limit_end, -1, "day")), s.end_date < e.config.limit_start && (s.end_date = new Date(e.config.limit_start)), s.end_date.valueOf() >= e.config.limit_end.valueOf() && (s.end_date = this.date.add(e.config.limit_end, -1, "day")), s.start_date.valueOf() >= s.end_date.valueOf() && (s.end_date = this.date.add(s.start_date, this.config.event_duration || this.config.time_step, "minute")), s._timed = this.isOneDayEvent(s)), !0;
        }), e.attachEvent("onEventChanged", function(i) {
          if (!i)
            return !0;
          var s = e.getEvent(i);
          if (!r(s)) {
            if (!a)
              return !1;
            s.start_date = a[0], s.end_date = a[1], s._timed = this.isOneDayEvent(s);
          }
          return !0;
        }), e.attachEvent("onBeforeEventChanged", function(i, s, _) {
          return r(i);
        }), e.attachEvent("onBeforeEventCreated", function(i) {
          var s = e.getActionData(i).date, _ = { _timed: !0, start_date: s, end_date: e.date.add(s, e.config.time_step, "minute") };
          return r(_);
        }), e.attachEvent("onViewChange", function() {
          e._mark_now();
        }), e.attachEvent("onAfterSchedulerResize", function() {
          return window.setTimeout(function() {
            if (e.$destroyed)
              return !0;
            e._mark_now();
          }, 1), !0;
        }), e.attachEvent("onTemplatesReady", function() {
          e._mark_now_timer = window.setInterval(function() {
            e._is_initialized() && e._mark_now();
          }, 6e4);
        }), e.attachEvent("onDestroy", function() {
          clearInterval(e._mark_now_timer);
        }), e._mark_now = function(i) {
          var s = "dhx_now_time";
          this._els[s] || (this._els[s] = []);
          var _ = e._currentDate(), l = this.config;
          if (e._remove_mark_now(), !i && l.mark_now && _ < this._max_date && _ > this._min_date && _.getHours() >= l.first_hour && _.getHours() < l.last_hour) {
            var h = this.locate_holder_day(_);
            this._els[s] = e._append_mark_now(h, _);
          }
        }, e._append_mark_now = function(i, s) {
          var _ = "dhx_now_time", l = e._get_zone_minutes(s), h = { zones: [l, l + 1], css: _, type: _ };
          if (!this._table_view) {
            if (this._props && this._props[this._mode]) {
              var u, m, f = this._props[this._mode], y = f.size || f.options.length;
              f.days > 1 ? (f.size && f.options.length && (i = (f.position + i) / f.options.length * f.size), u = i, m = i + y) : m = (u = 0) + y;
              for (var b = [], c = u; c < m; c++) {
                var g = c;
                h.days = g;
                var v = e._render_marked_timespan(h, null, g)[0];
                b.push(v);
              }
              return b;
            }
            return h.days = i, e._render_marked_timespan(h, null, i);
          }
          if (this._mode == "month")
            return h.days = +e.date.date_part(s), e._render_marked_timespan(h, null, null);
        }, e._remove_mark_now = function() {
          for (var i = "dhx_now_time", s = this._els[i], _ = 0; _ < s.length; _++) {
            var l = s[_], h = l.parentNode;
            h && h.removeChild(l);
          }
          this._els[i] = [];
        }, e._marked_timespans = { global: {} }, e._get_zone_minutes = function(i) {
          return 60 * i.getHours() + i.getMinutes();
        }, e._prepare_timespan_options = function(i) {
          var s = [], _ = [];
          if (i.days == "fullweek" && (i.days = [0, 1, 2, 3, 4, 5, 6]), i.days instanceof Array) {
            for (var l = i.days.slice(), h = 0; h < l.length; h++) {
              var u = e._lame_clone(i);
              u.days = l[h], s.push.apply(s, e._prepare_timespan_options(u));
            }
            return s;
          }
          if (!i || !(i.start_date && i.end_date && i.end_date > i.start_date || i.days !== void 0 && i.zones) && !i.type)
            return s;
          i.zones == "fullday" && (i.zones = [0, 1440]), i.zones && i.invert_zones && (i.zones = e.invertZones(i.zones)), i.id = e.uid(), i.css = i.css || "", i.type = i.type || n;
          var m = i.sections;
          if (m) {
            for (var f in m)
              if (m.hasOwnProperty(f)) {
                var y = m[f];
                for (y instanceof Array || (y = [y]), h = 0; h < y.length; h++)
                  (w = e._lame_copy({}, i)).sections = {}, w.sections[f] = y[h], _.push(w);
              }
          } else
            _.push(i);
          for (var b = 0; b < _.length; b++) {
            var c = _[b], g = c.start_date, v = c.end_date;
            if (g && v)
              for (var p = e.date.date_part(new Date(g)), x = e.date.add(p, 1, "day"); p < v; ) {
                var w;
                delete (w = e._lame_copy({}, c)).start_date, delete w.end_date, w.days = p.valueOf();
                var k = g > p ? e._get_zone_minutes(g) : 0, E = v > x || v.getDate() != p.getDate() ? 1440 : e._get_zone_minutes(v);
                w.zones = [k, E], s.push(w), p = x, x = e.date.add(x, 1, "day");
              }
            else
              c.days instanceof Date && (c.days = e.date.date_part(c.days).valueOf()), c.zones = i.zones.slice(), s.push(c);
          }
          return s;
        }, e._get_dates_by_index = function(i, s, _) {
          var l = [];
          s = e.date.date_part(new Date(s || e._min_date)), _ = new Date(_ || e._max_date);
          for (var h = s.getDay(), u = i - h >= 0 ? i - h : 7 - s.getDay() + i, m = e.date.add(s, u, "day"); m < _; m = e.date.add(m, 1, "week"))
            l.push(m);
          return l;
        }, e._get_css_classes_by_config = function(i) {
          var s = [];
          return i.type == t && (s.push(t), i.css && s.push(t + "_reset")), s.push("dhx_marked_timespan", i.css), s.join(" ");
        }, e._get_block_by_config = function(i) {
          var s = document.createElement("div");
          return i.html && (typeof i.html == "string" ? s.innerHTML = i.html : s.appendChild(i.html)), s;
        }, e._render_marked_timespan = function(i, s, _) {
          var l = [], h = e.config, u = this._min_date, m = this._max_date, f = !1;
          if (!h.display_marked_timespans)
            return l;
          if (!_ && _ !== 0) {
            if (i.days < 7)
              _ = i.days;
            else {
              var y = new Date(i.days);
              if (f = +y, !(+m > +y && +u <= +y))
                return l;
              _ = y.getDay();
            }
            var b = u.getDay();
            b > _ ? _ = 7 - (b - _) : _ -= b;
          }
          var c = i.zones, g = e._get_css_classes_by_config(i);
          if (e._table_view && e._mode == "month") {
            var v = [], p = [];
            if (s)
              v.push(s), p.push(_);
            else {
              p = f ? [f] : e._get_dates_by_index(_);
              for (var x = 0; x < p.length; x++)
                v.push(this._scales[p[x]]);
            }
            for (x = 0; x < v.length; x++) {
              s = v[x], _ = p[x];
              var w = this.locate_holder_day(_, !1) % this._cols.length;
              if (!this._ignores[w]) {
                var k = e._get_block_by_config(i);
                k.className = g, k.style.top = "0px", k.style.height = "100%";
                for (var E = 0; E < c.length; E += 2) {
                  var D = c[x];
                  if ((M = c[x + 1]) <= D)
                    return [];
                  (C = k.cloneNode(!0)).style.left = "0px", C.style.width = "100%", s.appendChild(C), l.push(C);
                }
              }
            }
          } else {
            var S = _;
            if (this._ignores[this.locate_holder_day(_, !1)])
              return l;
            if (this._props && this._props[this._mode] && i.sections && i.sections[this._mode]) {
              var N = this._props[this._mode];
              S = N.order[i.sections[this._mode]];
              var A = N.order[i.sections[this._mode]];
              N.days > 1 ? S = S * (N.size || N.options.length) + A : (S = A, N.size && S > N.position + N.size && (S = 0));
            }
            for (s = s || e.locate_holder(S), x = 0; x < c.length; x += 2) {
              var M, C;
              if (D = Math.max(c[x], 60 * h.first_hour), (M = Math.min(c[x + 1], 60 * h.last_hour)) <= D) {
                if (x + 2 < c.length)
                  continue;
                return [];
              }
              (C = e._get_block_by_config(i)).className = g;
              var T = 24 * this.config.hour_size_px + 1, O = 36e5;
              C.style.top = Math.round((60 * D * 1e3 - this.config.first_hour * O) * this.config.hour_size_px / O) % T + "px", C.style.height = Math.max(Math.round(60 * (M - D) * 1e3 * this.config.hour_size_px / O) % T, 1) + "px", s.appendChild(C), l.push(C);
            }
          }
          return l;
        }, e._mark_timespans = function() {
          var i = this._els.dhx_cal_data[0], s = [];
          if (e._table_view && e._mode == "month")
            for (var _ in this._scales) {
              var l = /* @__PURE__ */ new Date(+_);
              s.push.apply(s, e._on_scale_add_marker(this._scales[_], l));
            }
          else {
            l = new Date(e._min_date);
            for (var h = 0, u = i.childNodes.length; h < u; h++) {
              var m = i.childNodes[h];
              m.firstChild && e._getClassName(m.firstChild).indexOf("dhx_scale_hour") > -1 || (s.push.apply(s, e._on_scale_add_marker(m, l)), l = e.date.add(l, 1, "day"));
            }
          }
          return s;
        }, e.markTimespan = function(i) {
          if (!this._els)
            throw new Error("`scheduler.markTimespan` can't be used before scheduler initialization. Place `scheduler.markTimespan` call after `scheduler.init`.");
          var s = !1;
          this._els.dhx_cal_data || (e.get_elements(), s = !0);
          var _ = e._marked_timespans_ids, l = e._marked_timespans_types, h = e._marked_timespans;
          e.deleteMarkedTimespan(), e.addMarkedTimespan(i);
          var u = e._mark_timespans();
          return s && (e._els = []), e._marked_timespans_ids = _, e._marked_timespans_types = l, e._marked_timespans = h, u;
        }, e.unmarkTimespan = function(i) {
          if (i)
            for (var s = 0; s < i.length; s++) {
              var _ = i[s];
              _.parentNode && _.parentNode.removeChild(_);
            }
        }, e._addMarkerTimespanConfig = function(i) {
          var s = "global", _ = e._marked_timespans, l = i.id, h = e._marked_timespans_ids;
          h[l] || (h[l] = []);
          var u = i.days, m = i.sections, f = i.type;
          if (i.id = l, m) {
            for (var y in m)
              if (m.hasOwnProperty(y)) {
                _[y] || (_[y] = {});
                var b = m[y], c = _[y];
                c[b] || (c[b] = {}), c[b][u] || (c[b][u] = {}), c[b][u][f] || (c[b][u][f] = [], e._marked_timespans_types || (e._marked_timespans_types = {}), e._marked_timespans_types[f] || (e._marked_timespans_types[f] = !0));
                var g = c[b][u][f];
                i._array = g, g.push(i), h[l].push(i);
              }
          } else
            _[s][u] || (_[s][u] = {}), _[s][u][f] || (_[s][u][f] = []), e._marked_timespans_types || (e._marked_timespans_types = {}), e._marked_timespans_types[f] || (e._marked_timespans_types[f] = !0), g = _[s][u][f], i._array = g, g.push(i), h[l].push(i);
        }, e._marked_timespans_ids = {}, e.addMarkedTimespan = function(i) {
          var s = e._prepare_timespan_options(i);
          if (s.length) {
            for (var _ = s[0].id, l = 0; l < s.length; l++)
              e._addMarkerTimespanConfig(s[l]);
            return _;
          }
        }, e._add_timespan_zones = function(i, s) {
          var _ = i.slice();
          if (s = s.slice(), !_.length)
            return s;
          for (var l = 0; l < _.length; l += 2)
            for (var h = _[l], u = _[l + 1], m = l + 2 == _.length, f = 0; f < s.length; f += 2) {
              var y = s[f], b = s[f + 1];
              if (b > u && y <= u || y < h && b >= h)
                _[l] = Math.min(h, y), _[l + 1] = Math.max(u, b), l -= 2;
              else {
                if (!m)
                  continue;
                var c = h > y ? 0 : 2;
                _.splice(l + c, 0, y, b);
              }
              s.splice(f--, 2);
              break;
            }
          return _;
        }, e._subtract_timespan_zones = function(i, s) {
          for (var _ = i.slice(), l = 0; l < _.length; l += 2)
            for (var h = _[l], u = _[l + 1], m = 0; m < s.length; m += 2) {
              var f = s[m], y = s[m + 1];
              if (y > h && f < u) {
                var b = !1;
                h >= f && u <= y && _.splice(l, 2), h < f && (_.splice(l, 2, h, f), b = !0), u > y && _.splice(b ? l + 2 : l, b ? 0 : 2, y, u), l -= 2;
                break;
              }
            }
          return _;
        }, e.invertZones = function(i) {
          return e._subtract_timespan_zones([0, 1440], i.slice());
        }, e._delete_marked_timespan_by_id = function(i) {
          var s = e._marked_timespans_ids[i];
          if (s) {
            for (var _ = 0; _ < s.length; _++)
              for (var l = s[_], h = l._array, u = 0; u < h.length; u++)
                if (h[u] == l) {
                  h.splice(u, 1);
                  break;
                }
          }
        }, e._delete_marked_timespan_by_config = function(i) {
          var s, _ = e._marked_timespans, l = i.sections, h = i.days, u = i.type || n;
          if (l) {
            for (var m in l)
              if (l.hasOwnProperty(m) && _[m]) {
                var f = l[m];
                _[m][f] && (s = _[m][f]);
              }
          } else
            s = _.global;
          if (s) {
            if (h !== void 0)
              s[h] && s[h][u] && (e._addMarkerTimespanConfig(i), e._delete_marked_timespans_list(s[h][u], i));
            else
              for (var y in s)
                if (s[y][u]) {
                  var b = e._lame_clone(i);
                  i.days = y, e._addMarkerTimespanConfig(b), e._delete_marked_timespans_list(s[y][u], i);
                }
          }
        }, e._delete_marked_timespans_list = function(i, s) {
          for (var _ = 0; _ < i.length; _++) {
            var l = i[_], h = e._subtract_timespan_zones(l.zones, s.zones);
            if (h.length)
              l.zones = h;
            else {
              i.splice(_, 1), _--;
              for (var u = e._marked_timespans_ids[l.id], m = 0; m < u.length; m++)
                if (u[m] == l) {
                  u.splice(m, 1);
                  break;
                }
            }
          }
        }, e.deleteMarkedTimespan = function(i) {
          if (arguments.length || (e._marked_timespans = { global: {} }, e._marked_timespans_ids = {}, e._marked_timespans_types = {}), typeof i != "object")
            e._delete_marked_timespan_by_id(i);
          else {
            i.start_date && i.end_date || (i.days !== void 0 || i.type || (i.days = "fullweek"), i.zones || (i.zones = "fullday"));
            var s = [];
            if (i.type)
              s.push(i.type);
            else
              for (var _ in e._marked_timespans_types)
                s.push(_);
            for (var l = e._prepare_timespan_options(i), h = 0; h < l.length; h++)
              for (var u = l[h], m = 0; m < s.length; m++) {
                var f = e._lame_clone(u);
                f.type = s[m], e._delete_marked_timespan_by_config(f);
              }
          }
        }, e._get_types_to_render = function(i, s) {
          var _ = i ? e._lame_copy({}, i) : {};
          for (var l in s || {})
            s.hasOwnProperty(l) && (_[l] = s[l]);
          return _;
        }, e._get_configs_to_render = function(i) {
          var s = [];
          for (var _ in i)
            i.hasOwnProperty(_) && s.push.apply(s, i[_]);
          return s;
        }, e._on_scale_add_marker = function(i, s) {
          if (!e._table_view || e._mode == "month") {
            var _ = s.getDay(), l = s.valueOf(), h = this._mode, u = e._marked_timespans, m = [], f = [];
            if (this._props && this._props[h]) {
              var y = this._props[h], b = y.options, c = b[e._get_unit_index(y, s)];
              if (y.days > 1) {
                var g = Math.round((s - e._min_date) / 864e5), v = y.size || b.length;
                s = e.date.add(e._min_date, Math.floor(g / v), "day"), s = e.date.date_part(s);
              } else
                s = e.date.date_part(new Date(this._date));
              if (_ = s.getDay(), l = s.valueOf(), u[h] && u[h][c.key]) {
                var p = u[h][c.key], x = e._get_types_to_render(p[_], p[l]);
                m.push.apply(m, e._get_configs_to_render(x));
              }
            }
            var w = u.global;
            if (e.config.overwrite_marked_timespans) {
              var k = w[l] || w[_];
              m.push.apply(m, e._get_configs_to_render(k));
            } else
              w[l] && m.push.apply(m, e._get_configs_to_render(w[l])), w[_] && m.push.apply(m, e._get_configs_to_render(w[_]));
            for (var E = 0; E < m.length; E++)
              f.push.apply(f, e._render_marked_timespan(m[E], i, s));
            return f;
          }
        }, e.attachEvent("onScaleAdd", function() {
          e._on_scale_add_marker.apply(e, arguments);
        }), e.dblclick_dhx_marked_timespan = function(i, s) {
          e.callEvent("onScaleDblClick", [e.getActionData(i).date, s, i]), e.config.dblclick_create && e.addEventNow(e.getActionData(i).date, null, i);
        };
      }, e._temp_limit_scope();
    }
    function map_view(e) {
      e.ext || (e.ext = {}), e.ext.mapView = { geocoder: null, map: null, points: null, markers: null, infoWindow: null, createMarker: function(a) {
        return new google.maps.Marker(a);
      } }, e.xy.map_date_width = 188, e.xy.map_icon_width = 25, e.xy.map_description_width = 400, e.config.map_resolve_event_location = !0, e.config.map_resolve_user_location = !0, e.config.map_initial_position = new google.maps.LatLng(48.724, 8.215), e.config.map_error_position = new google.maps.LatLng(15, 15), e.config.map_infowindow_max_width = 300, e.config.map_type = google.maps.MapTypeId.ROADMAP, e.config.map_zoom_after_resolve = 15, e.locale.labels.marker_geo_success = "It seems you are here.", e.locale.labels.marker_geo_fail = "Sorry, could not get your current position using geolocation.", e.templates.marker_date = e.date.date_to_str("%Y-%m-%d %H:%i"), e.templates.marker_text = function(a, t, n) {
        return "<div><b>" + n.text + "</b><br/><br/>" + (n.event_location || "") + "<br/><br/>" + e.templates.marker_date(a) + " - " + e.templates.marker_date(t) + "</div>";
      }, e.dblclick_dhx_map_area = function() {
        !this.config.readonly && this.config.dblclick_create && this.addEventNow({ start_date: e._date, end_date: e.date.add(e._date, e.config.time_step, "minute") });
      }, e.templates.map_time = function(a, t, n) {
        return e.config.rtl && !n._timed ? e.templates.day_date(t) + " &ndash; " + e.templates.day_date(a) : n._timed ? this.day_date(n.start_date, n.end_date, n) + " " + this.event_date(a) : e.templates.day_date(a) + " &ndash; " + e.templates.day_date(t);
      }, e.templates.map_text = function(a, t, n) {
        return n.text;
      }, e.date.map_start = function(a) {
        return a;
      }, e.date.add_map = function(a, t, n) {
        return new Date(a.valueOf());
      }, e.templates.map_date = function(a, t, n) {
        return "";
      }, e._latLngUpdate = !1, e.attachEvent("onSchedulerReady", function() {
        e._isMapPositionSet = !1;
        const a = document.createElement("div");
        a.className = "dhx_map", a.id = "dhx_gmap", a.style.display = "none", e._obj.appendChild(a), e._els.dhx_gmap = [], e._els.dhx_gmap.push(a), i("dhx_gmap");
        const t = { zoom: e.config.map_initial_zoom || 10, center: e.config.map_initial_position, mapTypeId: e.config.map_type || google.maps.MapTypeId.ROADMAP }, n = new google.maps.Map(document.getElementById("dhx_gmap"), t);
        n.disableDefaultUI = !1, n.disableDoubleClickZoom = !e.config.readonly, google.maps.event.addListener(n, "dblclick", function(u) {
          const m = e.ext.mapView.geocoder;
          if (!e.config.readonly && e.config.dblclick_create) {
            var f = u.latLng;
            m.geocode({ latLng: f }, function(y, b) {
              b == google.maps.GeocoderStatus.OK && (f = y[0].geometry.location, e.addEventNow({ lat: f.lat(), lng: f.lng(), event_location: y[0].formatted_address, start_date: e._date, end_date: e.date.add(e._date, e.config.time_step, "minute") }));
            });
          }
        });
        var o = { content: "" };
        e.config.map_infowindow_max_width && (o.maxWidth = e.config.map_infowindow_max_width), e.map = { _points: [], _markers: [], _infowindow: new google.maps.InfoWindow(o), _infowindows_content: [], _initialization_count: -1, _obj: n }, e.ext.mapView.geocoder = new google.maps.Geocoder(), e.ext.mapView.map = n, e.ext.mapView.points = e.map._points, e.ext.mapView.markers = e.map._markers, e.ext.mapView.infoWindow = e.map._infowindow, e.config.map_resolve_user_location && navigator.geolocation && (e._isMapPositionSet || navigator.geolocation.getCurrentPosition(function(u) {
          var m = new google.maps.LatLng(u.coords.latitude, u.coords.longitude);
          n.setCenter(m), n.setZoom(e.config.map_zoom_after_resolve || 10), e.map._infowindow.setContent(e.locale.labels.marker_geo_success), e.map._infowindow.position = n.getCenter(), e.map._infowindow.open(n), e._isMapPositionSet = !0;
        }, function() {
          e.map._infowindow.setContent(e.locale.labels.marker_geo_fail), e.map._infowindow.setPosition(n.getCenter()), e.map._infowindow.open(n), e._isMapPositionSet = !0;
        })), google.maps.event.addListener(n, "resize", function(u) {
          a.style.zIndex = "5", n.setZoom(n.getZoom());
        }), google.maps.event.addListener(n, "tilesloaded", function(u) {
          a.style.zIndex = "5";
        }), a.style.display = "none";
        const r = e.render_data;
        function d() {
          var u = e.get_visible_events();
          u.sort(function(k, E) {
            return k.start_date.valueOf() == E.start_date.valueOf() ? k.id > E.id ? 1 : -1 : k.start_date > E.start_date ? 1 : -1;
          });
          for (var m = "<div " + (v = e._waiAria.mapAttrString()) + " class='dhx_map_area'>", f = 0; f < u.length; f++) {
            var y = u[f], b = y.id == e._selected_event_id ? "dhx_map_line highlight" : "dhx_map_line", c = y.color ? "--dhx-scheduler-event-background:" + y.color + ";" : "", g = y.textColor ? "--dhx-scheduler-event-color:" + y.textColor + ";" : "", v = e._waiAria.mapRowAttrString(y), p = e._waiAria.mapDetailsBtnString();
            m += "<div " + v + " class='" + b + "' event_id='" + y.id + "' " + e.config.event_attribute + "='" + y.id + "' style='" + c + g + (y._text_style || "") + " width: " + (e.xy.map_date_width + e.xy.map_description_width + 2) + "px;'><div class='dhx_map_event_time' style='width: " + e.xy.map_date_width + "px;' >" + e.templates.map_time(y.start_date, y.end_date, y) + "</div>", m += `<div ${p} class='dhx_event_icon icon_details'><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M15.4444 16.4H4.55556V7.6H15.4444V16.4ZM13.1111 2V3.6H6.88889V2H5.33333V3.6H4.55556C3.69222 3.6 3 4.312 3 5.2V16.4C3 16.8243 3.16389 17.2313 3.45561 17.5314C3.74733 17.8314 4.143 18 4.55556 18H15.4444C15.857 18 16.2527 17.8314 16.5444 17.5314C16.8361 17.2313 17 16.8243 17 16.4V5.2C17 4.312 16.3 3.6 15.4444 3.6H14.6667V2H13.1111ZM13.8889 10.8H10V14.8H13.8889V10.8Z" fill="#A1A4A6"/>
			</svg></div>`, m += "<div class='line_description' style='width:" + (e.xy.map_description_width - e.xy.map_icon_width) + "px;'>" + e.templates.map_text(y.start_date, y.end_date, y) + "</div></div>";
          }
          m += "<div class='dhx_v_border' style=" + (e.config.rtl ? "'right: " : "'left: ") + (e.xy.map_date_width - 1) + "px;'></div><div class='dhx_v_border_description'></div></div>", e._els.dhx_cal_data[0].scrollTop = 0, e._els.dhx_cal_data[0].innerHTML = m;
          var x = e._els.dhx_cal_data[0].firstChild.childNodes, w = e._getNavDateElement();
          for (w && (w.innerHTML = e.templates[e._mode + "_date"](e._min_date, e._max_date, e._mode)), e._rendered = [], f = 0; f < x.length - 2; f++)
            e._rendered[f] = x[f];
        }
        function i(u) {
          var m = document.getElementById(u);
          const f = e.$container.querySelector(".dhx_cal_navline").offsetHeight;
          var y = e._y - f;
          y < 0 && (y = 0);
          var b = e._x - e.xy.map_date_width - e.xy.map_description_width - 1;
          b < 0 && (b = 0), m.style.height = y + "px", m.style.width = b + "px", m.style.position = "absolute", m.style.top = f + "px", e.config.rtl ? m.style.marginRight = e.xy.map_date_width + e.xy.map_description_width + 1 + "px" : m.style.marginLeft = e.xy.map_date_width + e.xy.map_description_width + 1 + "px", m.style.marginTop = e.xy.nav_height + 2 + "px";
        }
        e.render_data = function(u, m) {
          if (this._mode != "map")
            return r.apply(this, arguments);
          d();
          for (var f = e.get_visible_events(), y = 0; y < f.length; y++)
            e.map._markers[f[y].id] || _(f[y], !1, !1);
        }, e.map_view = function(u) {
          e.map._initialization_count++;
          var m, f = e._els.dhx_gmap[0];
          if (e._min_date = e.config.map_start || e._currentDate(), e._max_date = e.config.map_end || e.date.add(e._currentDate(), 1, "year"), e._table_view = !0, function(c) {
            if (c) {
              var g = e.locale.labels;
              e._els.dhx_cal_header[0].innerHTML = "<div class='dhx_map_head' style='width: " + (e.xy.map_date_width + e.xy.map_description_width + 2) + "px;' ><div class='headline_date' style='width: " + e.xy.map_date_width + "px;'>" + g.date + "</div><div class='headline_description' style='width: " + e.xy.map_description_width + "px;'>" + g.description + "</div></div>", e._table_view = !0, e.set_sizes();
            }
          }(u), u) {
            ((function() {
              e._selected_event_id = null, e.map._infowindow.close();
              var c = e.map._markers;
              for (var g in c)
                c.hasOwnProperty(g) && (c[g].setMap(null), delete e.map._markers[g], e.map._infowindows_content[g] && delete e.map._infowindows_content[g]);
            }))(), d(), f.style.display = "block", i("dhx_gmap"), m = e.map._obj.getCenter();
            for (var y = e.get_visible_events(), b = 0; b < y.length; b++)
              e.map._markers[y[b].id] || _(y[b]);
          } else
            f.style.display = "none";
          google.maps.event.trigger(e.map._obj, "resize"), e.map._initialization_count === 0 && m && e.map._obj.setCenter(m), e._selected_event_id && s(e._selected_event_id);
        };
        var s = function(u) {
          e.map._obj.setCenter(e.map._points[u]), e.callEvent("onClick", [u]);
        }, _ = function(u, m, f) {
          var y = e.config.map_error_position;
          u.lat && u.lng && (y = new google.maps.LatLng(u.lat, u.lng));
          var b = e.templates.marker_text(u.start_date, u.end_date, u);
          e._new_event || (e.map._infowindows_content[u.id] = b, e.map._markers[u.id] && e.map._markers[u.id].setMap(null), e.map._markers[u.id] = e.ext.mapView.createMarker({ position: y, map: e.map._obj }), google.maps.event.addListener(e.map._markers[u.id], "click", function() {
            e.map._infowindow.setContent(e.map._infowindows_content[u.id]), e.map._infowindow.open(e.map._obj, e.map._markers[u.id]), e._selected_event_id = u.id, e.render_data();
          }), e.map._points[u.id] = y, m && e.map._obj.setCenter(e.map._points[u.id]), f && e.callEvent("onClick", [u.id]));
        };
        e.attachEvent("onClick", function(u, m) {
          if (this._mode == "map") {
            e._selected_event_id = u;
            for (var f = 0; f < e._rendered.length; f++)
              e._rendered[f].className = "dhx_map_line", e._rendered[f].getAttribute(e.config.event_attribute) == u && (e._rendered[f].className += " highlight");
            e.map._points[u] && e.map._markers[u] && (e.map._obj.setCenter(e.map._points[u]), google.maps.event.trigger(e.map._markers[u], "click"));
          }
          return !0;
        });
        var l = function(u) {
          const m = e.ext.mapView.geocoder;
          u.event_location && m ? m.geocode({ address: u.event_location, language: e.uid().toString() }, function(f, y) {
            var b = {};
            y != google.maps.GeocoderStatus.OK ? (b = e.callEvent("onLocationError", [u.id])) && b !== !0 || (b = e.config.map_error_position) : b = f[0].geometry.location, u.lat = b.lat(), u.lng = b.lng(), e._selected_event_id = u.id, e._latLngUpdate = !0, e.callEvent("onEventChanged", [u.id, u]), _(u, !0, !0);
          }) : _(u, !0, !0);
        }, h = function(u) {
          const m = e.ext.mapView.geocoder;
          u.event_location && m && m.geocode({ address: u.event_location, language: e.uid().toString() }, function(f, y) {
            var b = {};
            y != google.maps.GeocoderStatus.OK ? (b = e.callEvent("onLocationError", [u.id])) && b !== !0 || (b = e.config.map_error_position) : b = f[0].geometry.location, u.lat = b.lat(), u.lng = b.lng(), e._latLngUpdate = !0, e.callEvent("onEventChanged", [u.id, u]);
          });
        };
        e.attachEvent("onEventChanged", function(u, m) {
          return this._latLngUpdate ? this._latLngUpdate = !1 : (m = e.getEvent(u)).start_date < e._min_date && m.end_date > e._min_date || m.start_date < e._max_date && m.end_date > e._max_date || m.start_date.valueOf() >= e._min_date && m.end_date.valueOf() <= e._max_date ? (e.map._markers[u] && e.map._markers[u].setMap(null), l(m)) : (e._selected_event_id = null, e.map._infowindow.close(), e.map._markers[u] && e.map._markers[u].setMap(null)), !0;
        }), e.attachEvent("onEventIdChange", function(u, m) {
          var f = e.getEvent(m);
          return (f.start_date < e._min_date && f.end_date > e._min_date || f.start_date < e._max_date && f.end_date > e._max_date || f.start_date.valueOf() >= e._min_date && f.end_date.valueOf() <= e._max_date) && (e.map._markers[u] && (e.map._markers[u].setMap(null), delete e.map._markers[u]), e.map._infowindows_content[u] && delete e.map._infowindows_content[u], l(f)), !0;
        }), e.attachEvent("onEventAdded", function(u, m) {
          return e._dataprocessor || (m.start_date < e._min_date && m.end_date > e._min_date || m.start_date < e._max_date && m.end_date > e._max_date || m.start_date.valueOf() >= e._min_date && m.end_date.valueOf() <= e._max_date) && (e.map._markers[u] && e.map._markers[u].setMap(null), l(m)), !0;
        }), e.attachEvent("onBeforeEventDelete", function(u, m) {
          return e.map._markers[u] && e.map._markers[u].setMap(null), e._selected_event_id = null, e.map._infowindow.close(), !0;
        }), e._event_resolve_delay = 1500, e.attachEvent("onEventLoading", function(u) {
          return e.config.map_resolve_event_location && u.event_location && !u.lat && !u.lng && (e._event_resolve_delay += 1500, function(m, f, y, b) {
            setTimeout(function() {
              if (e.$destroyed)
                return !0;
              var c = m.apply(f, y);
              return m = f = y = null, c;
            }, b || 1);
          }(h, this, [u], e._event_resolve_delay)), !0;
        }), e.attachEvent("onEventCancel", function(u, m) {
          return m && (e.map._markers[u] && e.map._markers[u].setMap(null), e.map._infowindow.close()), !0;
        });
      });
    }
    function minical(e) {
      const a = e._createDomEventScope();
      e.config.minicalendar = { mark_events: !0 }, e._synced_minicalendars = [], e.renderCalendar = function(t, n, o) {
        var r = null, d = t.date || e._currentDate();
        if (typeof d == "string" && (d = this.templates.api_date(d)), n)
          r = this._render_calendar(n.parentNode, d, t, n), e.unmarkCalendar(r);
        else {
          var i = t.container, s = t.position;
          if (typeof i == "string" && (i = document.getElementById(i)), typeof s == "string" && (s = document.getElementById(s)), s && s.left === void 0 && s.right === void 0) {
            var _ = e.$domHelpers.getOffset(s);
            s = { top: _.top + s.offsetHeight, left: _.left };
          }
          i || (i = e._get_def_cont(s)), (r = this._render_calendar(i, d, t)).$_eventAttached || (r.$_eventAttached = !0, a.attach(r, "click", (function(g) {
            var v = g.target || g.srcElement, p = e.$domHelpers;
            if (p.closest(v, ".dhx_month_head") && !p.closest(v, ".dhx_after") && !p.closest(v, ".dhx_before")) {
              var x = p.closest(v, "[data-cell-date]").getAttribute("data-cell-date"), w = e.templates.parse_date(x);
              e.unmarkCalendar(this), e.markCalendar(this, w, "dhx_calendar_click"), this._last_date = w, this.conf.handler && this.conf.handler.call(e, w, this);
            }
          }).bind(r)));
        }
        if (e.config.minicalendar.mark_events)
          for (var l = e.date.month_start(d), h = e.date.add(l, 1, "month"), u = this.getEvents(l, h), m = this["filter_" + this._mode], f = {}, y = 0; y < u.length; y++) {
            var b = u[y];
            if (!m || m(b.id, b)) {
              var c = b.start_date;
              for (c.valueOf() < l.valueOf() && (c = l), c = e.date.date_part(new Date(c.valueOf())); c < b.end_date && (f[+c] || (f[+c] = !0, this.markCalendar(r, c, "dhx_year_event")), !((c = this.date.add(c, 1, "day")).valueOf() >= h.valueOf())); )
                ;
            }
          }
        return this._markCalendarCurrentDate(r), r.conf = t, t.sync && !o && this._synced_minicalendars.push(r), r.conf._on_xle_handler || (r.conf._on_xle_handler = e.attachEvent("onXLE", function() {
          e.updateCalendar(r, r.conf.date);
        })), this.config.wai_aria_attributes && this.config.wai_aria_application_role && r.setAttribute("role", "application"), r;
      }, e._get_def_cont = function(t) {
        return this._def_count || (this._def_count = document.createElement("div"), this._def_count.className = "dhx_minical_popup", e.event(this._def_count, "click", function(n) {
          n.cancelBubble = !0;
        }), document.body.appendChild(this._def_count)), t.left && (this._def_count.style.left = t.left + "px"), t.right && (this._def_count.style.right = t.right + "px"), t.top && (this._def_count.style.top = t.top + "px"), t.bottom && (this._def_count.style.bottom = t.bottom + "px"), this._def_count._created = /* @__PURE__ */ new Date(), this._def_count;
      }, e._locateCalendar = function(t, n) {
        if (typeof n == "string" && (n = e.templates.api_date(n)), +n > +t._max_date || +n < +t._min_date)
          return null;
        for (var o = t.querySelector(".dhx_year_body").childNodes[0], r = 0, d = new Date(t._min_date); +this.date.add(d, 1, "week") <= +n; )
          d = this.date.add(d, 1, "week"), r++;
        var i = e.config.start_on_monday, s = (n.getDay() || (i ? 7 : 0)) - (i ? 1 : 0);
        const _ = o.querySelector(`.dhx_cal_month_row:nth-child(${r + 1}) .dhx_cal_month_cell:nth-child(${s + 1})`);
        return _ ? _.firstChild : null;
      }, e.markCalendar = function(t, n, o) {
        var r = this._locateCalendar(t, n);
        r && (r.className += " " + o);
      }, e.unmarkCalendar = function(t, n, o) {
        if (o = o || "dhx_calendar_click", n = n || t._last_date) {
          var r = this._locateCalendar(t, n);
          r && (r.className = (r.className || "").replace(RegExp(o, "g")));
        }
      }, e._week_template = function(t) {
        for (var n = t || 250, o = 0, r = document.createElement("div"), d = this.date.week_start(e._currentDate()), i = 0; i < 7; i++)
          this._cols[i] = Math.floor(n / (7 - i)), this._render_x_header(i, o, d, r), d = this.date.add(d, 1, "day"), n -= this._cols[i], o += this._cols[i];
        return r.lastChild.className += " dhx_scale_bar_last", r;
      }, e.updateCalendar = function(t, n) {
        t.conf.date = n, this.renderCalendar(t.conf, t, !0);
      }, e._mini_cal_arrows = ["&nbsp;", "&nbsp;"], e._render_calendar = function(t, n, o, r) {
        var d = e.templates, i = this._cols;
        this._cols = [];
        var s = this._mode;
        this._mode = "calendar";
        var _ = this._colsS;
        this._colsS = { height: 0 };
        var l = new Date(this._min_date), h = new Date(this._max_date), u = new Date(e._date), m = d.month_day, f = this._ignores_detected;
        this._ignores_detected = 0, d.month_day = d.calendar_date, n = this.date.month_start(n);
        var y, b = this._week_template(t.offsetWidth - 1 - this.config.minicalendar.padding);
        r ? y = r : (y = document.createElement("div")).className = "dhx_cal_container dhx_mini_calendar", y.setAttribute("date", this._helpers.formatDate(n)), y.innerHTML = "<div class='dhx_year_month'></div><div class='dhx_year_grid" + (e.config.rtl ? " dhx_grid_rtl'>" : "'>") + "<div class='dhx_year_week'>" + (b ? b.innerHTML : "") + "</div><div class='dhx_year_body'></div></div>";
        var c = y.querySelector(".dhx_year_month"), g = y.querySelector(".dhx_year_week"), v = y.querySelector(".dhx_year_body");
        if (c.innerHTML = this.templates.calendar_month(n), o.navigation)
          for (var p = function($, P) {
            var j = e.date.add($._date, P, "month");
            e.updateCalendar($, j), e._date.getMonth() == $._date.getMonth() && e._date.getFullYear() == $._date.getFullYear() && e._markCalendarCurrentDate($);
          }, x = ["dhx_cal_prev_button", "dhx_cal_next_button"], w = ["left:1px;top:4px;position:absolute;", "left:auto; right:1px;top:4px;position:absolute;"], k = [-1, 1], E = function($) {
            return function() {
              if (o.sync)
                for (var P = e._synced_minicalendars, j = 0; j < P.length; j++)
                  p(P[j], $);
              else
                e.config.rtl && ($ = -$), p(y, $);
            };
          }, D = [e.locale.labels.prev, e.locale.labels.next], S = 0; S < 2; S++) {
            var N = document.createElement("div");
            N.className = x[S], e._waiAria.headerButtonsAttributes(N, D[S]), N.style.cssText = w[S], N.innerHTML = this._mini_cal_arrows[S], c.appendChild(N), a.attach(N, "click", E(k[S]));
          }
        y._date = new Date(n), y.week_start = (n.getDay() - (this.config.start_on_monday ? 1 : 0) + 7) % 7;
        var A = y._min_date = this.date.week_start(n);
        y._max_date = this.date.add(y._min_date, 6, "week"), this._reset_month_scale(v, n, A, 6), r || t.appendChild(y), g.style.height = g.childNodes[0].offsetHeight - 1 + "px";
        var M = e.uid();
        e._waiAria.minicalHeader(c, M), e._waiAria.minicalGrid(y.querySelector(".dhx_year_grid"), M), e._waiAria.minicalRow(g);
        for (var C = g.querySelectorAll(".dhx_scale_bar"), T = 0; T < C.length; T++)
          e._waiAria.minicalHeadCell(C[T]);
        var O = v.querySelectorAll(".dhx_cal_month_cell"), L = new Date(A);
        for (T = 0; T < O.length; T++)
          e._waiAria.minicalDayCell(O[T], new Date(L)), L = e.date.add(L, 1, "day");
        return e._waiAria.minicalHeader(c, M), this._cols = i, this._mode = s, this._colsS = _, this._min_date = l, this._max_date = h, e._date = u, d.month_day = m, this._ignores_detected = f, y;
      }, e.destroyCalendar = function(t, n) {
        !t && this._def_count && this._def_count.firstChild && (n || (/* @__PURE__ */ new Date()).valueOf() - this._def_count._created.valueOf() > 500) && (t = this._def_count.firstChild), t && (a.detachAll(), t.innerHTML = "", t.parentNode && t.parentNode.removeChild(t), this._def_count && (this._def_count.style.top = "-1000px"), t.conf && t.conf._on_xle_handler && e.detachEvent(t.conf._on_xle_handler));
      }, e.isCalendarVisible = function() {
        return !!(this._def_count && parseInt(this._def_count.style.top, 10) > 0) && this._def_count;
      }, e.attachEvent("onTemplatesReady", function() {
        e.event(document.body, "click", function() {
          e.destroyCalendar();
        });
      }, { once: !0 }), e.form_blocks.calendar_time = { render: function(t) {
        var n = "<span class='dhx_minical_input_wrapper'><input class='dhx_readonly dhx_minical_input' type='text' readonly='true'></span>", o = e.config, r = this.date.date_part(e._currentDate()), d = 1440, i = 0;
        o.limit_time_select && (i = 60 * o.first_hour, d = 60 * o.last_hour + 1), r.setHours(i / 60), t._time_values = [], n += " <select class='dhx_lightbox_time_select'>";
        for (var s = i; s < d; s += 1 * this.config.time_step)
          n += "<option value='" + s + "'>" + this.templates.time_picker(r) + "</option>", t._time_values.push(s), r = this.date.add(r, this.config.time_step, "minute");
        return "<div class='dhx_section_time dhx_lightbox_minical'>" + (n += "</select>") + "<span class='dhx_lightbox_minical_spacer'> &nbsp;&ndash;&nbsp; </span>" + n + "</div>";
      }, set_value: function(t, n, o, r) {
        var d, i, s = t.getElementsByTagName("input"), _ = t.getElementsByTagName("select"), l = function(c, g, v) {
          e.event(c, "click", function() {
            e.destroyCalendar(null, !0), e.renderCalendar({ position: c, date: new Date(this._date), navigation: !0, handler: function(p) {
              c.value = e.templates.calendar_time(p), c._date = new Date(p), e.destroyCalendar(), e.config.event_duration && e.config.auto_end_date && v === 0 && f();
            } });
          });
        };
        if (e.config.full_day) {
          if (!t._full_day) {
            var h = "<label class='dhx_fullday'><input type='checkbox' name='full_day' value='true'> " + e.locale.labels.full_day + "&nbsp;</label></input>";
            e.config.wide_form || (h = t.previousSibling.innerHTML + h), t.previousSibling.innerHTML = h, t._full_day = !0;
          }
          var u = t.previousSibling.getElementsByTagName("input")[0], m = e.date.time_part(o.start_date) === 0 && e.date.time_part(o.end_date) === 0;
          u.checked = m, _[0].disabled = u.checked, _[1].disabled = u.checked, u.$_eventAttached || (u.$_eventAttached = !0, e.event(u, "click", function() {
            if (u.checked === !0) {
              var c = {};
              e.form_blocks.calendar_time.get_value(t, c), d = e.date.date_part(c.start_date), (+(i = e.date.date_part(c.end_date)) == +d || +i >= +d && (o.end_date.getHours() !== 0 || o.end_date.getMinutes() !== 0)) && (i = e.date.add(i, 1, "day"));
            }
            var g = d || o.start_date, v = i || o.end_date;
            y(s[0], g), y(s[1], v), _[0].value = 60 * g.getHours() + g.getMinutes(), _[1].value = 60 * v.getHours() + v.getMinutes(), _[0].disabled = u.checked, _[1].disabled = u.checked;
          }));
        }
        if (e.config.event_duration && e.config.auto_end_date) {
          var f = function() {
            e.config.auto_end_date && e.config.event_duration && (d = e.date.add(s[0]._date, _[0].value, "minute"), i = new Date(d.getTime() + 60 * e.config.event_duration * 1e3), s[1].value = e.templates.calendar_time(i), s[1]._date = e.date.date_part(new Date(i)), _[1].value = 60 * i.getHours() + i.getMinutes());
          };
          _[0].$_eventAttached || _[0].addEventListener("change", f);
        }
        function y(c, g, v) {
          l(c, g, v), c.value = e.templates.calendar_time(g), c._date = e.date.date_part(new Date(g));
        }
        function b(c) {
          for (var g = r._time_values, v = 60 * c.getHours() + c.getMinutes(), p = v, x = !1, w = 0; w < g.length; w++) {
            var k = g[w];
            if (k === v) {
              x = !0;
              break;
            }
            k < v && (p = k);
          }
          return x || p ? x ? v : p : -1;
        }
        y(s[0], o.start_date, 0), y(s[1], o.end_date, 1), l = function() {
        }, _[0].value = b(o.start_date), _[1].value = b(o.end_date);
      }, get_value: function(t, n) {
        var o = t.getElementsByTagName("input"), r = t.getElementsByTagName("select");
        return n.start_date = e.date.add(o[0]._date, r[0].value, "minute"), n.end_date = e.date.add(o[1]._date, r[1].value, "minute"), n.end_date <= n.start_date && (n.end_date = e.date.add(n.start_date, e.config.time_step, "minute")), { start_date: new Date(n.start_date), end_date: new Date(n.end_date) };
      }, focus: function(t) {
      } }, e.linkCalendar = function(t, n) {
        var o = function() {
          var r = e._date, d = new Date(r.valueOf());
          return n && (d = n(d)), d.setDate(1), e.updateCalendar(t, d), !0;
        };
        e.attachEvent("onViewChange", o), e.attachEvent("onXLE", o), e.attachEvent("onEventAdded", o), e.attachEvent("onEventChanged", o), e.attachEvent("onEventDeleted", o), o();
      }, e._markCalendarCurrentDate = function(t) {
        var n = e.getState(), o = n.min_date, r = n.max_date, d = n.mode, i = e.date.month_start(new Date(t._date)), s = e.date.add(i, 1, "month");
        if (!({ month: !0, year: !0, agenda: !0, grid: !0 }[d] || o.valueOf() <= i.valueOf() && r.valueOf() >= s.valueOf()))
          for (var _ = o; _.valueOf() < r.valueOf(); )
            i.valueOf() <= _.valueOf() && s > _ && e.markCalendar(t, _, "dhx_calendar_click"), _ = e.date.add(_, 1, "day");
      }, e.attachEvent("onEventCancel", function() {
        e.destroyCalendar(null, !0);
      }), e.attachEvent("onDestroy", function() {
        e.destroyCalendar();
      });
    }
    function monthheight(e) {
      e.attachEvent("onTemplatesReady", function() {
        e.xy.scroll_width = 0;
        var a = e.render_view_data;
        e.render_view_data = function() {
          var n = this._els.dhx_cal_data[0];
          n.firstChild._h_fix = !0, a.apply(e, arguments);
          var o = parseInt(n.style.height);
          n.style.height = "1px", n.style.height = n.scrollHeight + "px", this._obj.style.height = this._obj.clientHeight + n.scrollHeight - o + "px";
        };
        var t = e._reset_month_scale;
        e._reset_month_scale = function(n, o, r, d) {
          var i = { clientHeight: 100 };
          t.apply(e, [i, o, r, d]), n.innerHTML = i.innerHTML;
        };
      });
    }
    function multisection(e) {
      e.config.multisection = !0, e.config.multisection_shift_all = !0, e.config.section_delimiter = ",", e.attachEvent("onSchedulerReady", function() {
        extend$1(e);
        var a = e._update_unit_section;
        e._update_unit_section = function(i) {
          return e._update_sections(i, a);
        };
        var t = e._update_timeline_section;
        e._update_timeline_section = function(i) {
          return e._update_sections(i, t);
        }, e.isMultisectionEvent = function(i) {
          return !(!i || !this._get_multisection_view()) && this._get_event_sections(i).length > 1;
        }, e._get_event_sections = function(i) {
          var s = i[this._get_section_property()] || "";
          return this._parse_event_sections(s);
        }, e._parse_event_sections = function(i) {
          return i instanceof Array ? i : i.toString().split(e.config.section_delimiter);
        }, e._clear_copied_events(), e._split_events = function(i) {
          var s = [], _ = this._get_multisection_view(), l = this._get_section_property();
          if (_)
            for (var h = 0; h < i.length; h++) {
              var u = this._get_event_sections(i[h]);
              if (u.length > 1) {
                for (var m = 0; m < u.length; m++)
                  if (_.order[u[m]] !== void 0) {
                    var f = e._copy_event(i[h]);
                    f[l] = u[m], s.push(f);
                  }
              } else
                s.push(i[h]);
            }
          else
            s = i;
          return s;
        }, e._get_multisection_view = function() {
          return !!this.config.multisection && e._get_section_view();
        };
        var n = e.get_visible_events;
        e.get_visible_events = function(i) {
          this._clear_copied_events();
          var s = n.apply(this, arguments);
          if (this._get_multisection_view()) {
            s = this._split_events(s);
            for (var _ = 0; _ < s.length; _++)
              this.is_visible_events(s[_]) || (s.splice(_, 1), _--);
            this._register_copies_array(s);
          }
          return s;
        }, e._rendered_events = {};
        var o = e.render_view_data;
        e.render_view_data = function(i, s) {
          return this._get_multisection_view() && i && (i = this._split_events(i), this._restore_render_flags(i)), o.apply(this, [i, s]);
        }, e._update_sections = function(i, s) {
          var _ = i.view, l = i.event, h = i.pos;
          if (e.isMultisectionEvent(l)) {
            if (e._drag_event._orig_section || (e._drag_event._orig_section = h.section), e._drag_event._orig_section != h.section) {
              var u = _.order[h.section] - _.order[e._drag_event._orig_section];
              if (u) {
                var m = this._get_event_sections(l), f = [], y = !0;
                if (e.config.multisection_shift_all)
                  for (var b = 0; b < m.length; b++) {
                    if ((c = e._shift_sections(_, m[b], u)) === null) {
                      f = m, y = !1;
                      break;
                    }
                    f[b] = c;
                  }
                else
                  for (b = 0; b < m.length; b++) {
                    if (m[b] == h.section) {
                      f = m, y = !1;
                      break;
                    }
                    if (m[b] == e._drag_event._orig_section) {
                      var c;
                      if ((c = e._shift_sections(_, m[b], u)) === null) {
                        f = m, y = !1;
                        break;
                      }
                      f[b] = c;
                    } else
                      f[b] = m[b];
                  }
                y && (e._drag_event._orig_section = h.section), l[e._get_section_property()] = f.join(e.config.section_delimiter);
              }
            }
          } else
            s.apply(e, [i]);
        }, e._shift_sections = function(i, s, _) {
          for (var l = null, h = i.y_unit || i.options, u = 0; u < h.length; u++)
            if (h[u].key == s) {
              l = u;
              break;
            }
          var m = h[l + _];
          return m ? m.key : null;
        };
        var r = e._get_blocked_zones;
        e._get_blocked_zones = function(i, s, _, l, h) {
          if (s && this.config.multisection) {
            s = this._parse_event_sections(s);
            for (var u = [], m = 0; m < s.length; m++)
              u = u.concat(r.apply(this, [i, s[m], _, l, h]));
            return u;
          }
          return r.apply(this, arguments);
        };
        var d = e._check_sections_collision;
        e._check_sections_collision = function(i, s) {
          if (this.config.multisection && this._get_section_view()) {
            i = this._split_events([i]), s = this._split_events([s]);
            for (var _ = !1, l = 0, h = i.length; l < h && !_; l++)
              for (var u = 0, m = s.length; u < m; u++)
                if (d.apply(this, [i[l], s[u]])) {
                  _ = !0;
                  break;
                }
            return _;
          }
          return d.apply(this, arguments);
        };
      });
    }
    function multiselect(e) {
      e.form_blocks.multiselect = { render: function(a) {
        var t = "dhx_multi_select_control dhx_multi_select_" + a.name;
        a.vertical && (t += " dhx_multi_select_control_vertical");
        for (var n = "<div class='" + t + "' style='overflow: auto; max-height: " + a.height + "px; position: relative;' >", o = 0; o < a.options.length; o++)
          n += "<label><input type='checkbox' value='" + a.options[o].key + "'/>" + a.options[o].label + "</label>";
        return n += "</div>";
      }, set_value: function(a, t, n, o) {
        for (var r = a.getElementsByTagName("input"), d = 0; d < r.length; d++)
          r[d].checked = !1;
        function i(u) {
          for (var m = a.getElementsByTagName("input"), f = 0; f < m.length; f++)
            m[f].checked = !!u[m[f].value];
        }
        var s = {};
        if (n[o.map_to]) {
          var _ = (n[o.map_to] + "").split(o.delimiter || e.config.section_delimiter || ",");
          for (d = 0; d < _.length; d++)
            s[_[d]] = !0;
          i(s);
        } else {
          if (e._new_event || !o.script_url)
            return;
          var l = document.createElement("div");
          l.className = "dhx_loading", l.style.cssText = "position: absolute; top: 40%; left: 40%;", a.appendChild(l);
          var h = [o.script_url, o.script_url.indexOf("?") == -1 ? "?" : "&", "dhx_crosslink_" + o.map_to + "=" + n.id + "&uid=" + e.uid()].join("");
          e.ajax.get(h, function(u) {
            var m = function(f, y) {
              try {
                for (var b = JSON.parse(f.xmlDoc.responseText), c = {}, g = 0; g < b.length; g++) {
                  var v = b[g];
                  c[v.value || v.key || v.id] = !0;
                }
                return c;
              } catch {
                return null;
              }
            }(u);
            m || (m = function(f, y) {
              for (var b = e.ajax.xpath("//data/item", f.xmlDoc), c = {}, g = 0; g < b.length; g++)
                c[b[g].getAttribute(y.map_to)] = !0;
              return c;
            }(u, o)), i(m), a.removeChild(l);
          });
        }
      }, get_value: function(a, t, n) {
        for (var o = [], r = a.getElementsByTagName("input"), d = 0; d < r.length; d++)
          r[d].checked && o.push(r[d].value);
        return o.join(n.delimiter || e.config.section_delimiter || ",");
      }, focus: function(a) {
      } };
    }
    function multisource(e) {
      var a = e._load;
      e._load = function(t, n) {
        if (typeof (t = t || this._load_url) == "object")
          for (var o = function(d) {
            var i = function() {
            };
            return i.prototype = d, i;
          }(this._loaded), r = 0; r < t.length; r++)
            this._loaded = new o(), a.call(this, t[r], n);
        else
          a.apply(this, arguments);
      };
    }
    function mvc(e) {
      var a, t = { use_id: !1 };
      function n(d) {
        var i = {};
        for (var s in d)
          s.indexOf("_") !== 0 && (i[s] = d[s]);
        return t.use_id || delete i.id, i;
      }
      function o(d) {
        d._not_render = !1, d._render_wait && d.render_view_data(), d._loading = !1, d.callEvent("onXLE", []);
      }
      function r(d) {
        return t.use_id ? d.id : d.cid;
      }
      e.backbone = function(d, i) {
        i && (t = i), d.bind("change", function(l, h) {
          var u = r(l), m = e._events[u] = l.toJSON();
          m.id = u, e._init_event(m), clearTimeout(a), a = setTimeout(function() {
            if (e.$destroyed)
              return !0;
            e.updateView();
          }, 1);
        }), d.bind("remove", function(l, h) {
          var u = r(l);
          e._events[u] && e.deleteEvent(u);
        });
        var s = [];
        function _() {
          if (e.$destroyed)
            return !0;
          s.length && (e.parse(s, "json"), s = []);
        }
        d.bind("add", function(l, h) {
          var u = r(l);
          if (!e._events[u]) {
            var m = l.toJSON();
            m.id = u, e._init_event(m), s.push(m), s.length == 1 && setTimeout(_, 1);
          }
        }), d.bind("request", function(l) {
          var h;
          l instanceof Backbone.Collection && ((h = e)._loading = !0, h._not_render = !0, h.callEvent("onXLS", []));
        }), d.bind("sync", function(l) {
          l instanceof Backbone.Collection && o(e);
        }), d.bind("error", function(l) {
          l instanceof Backbone.Collection && o(e);
        }), e.attachEvent("onEventCreated", function(l) {
          var h = new d.model(e.getEvent(l));
          return e._events[l] = h.toJSON(), e._events[l].id = l, !0;
        }), e.attachEvent("onEventAdded", function(l) {
          if (!d.get(l)) {
            var h = n(e.getEvent(l)), u = new d.model(h), m = r(u);
            m != l && this.changeEventId(l, m), d.add(u), d.trigger("scheduler:add", u);
          }
          return !0;
        }), e.attachEvent("onEventChanged", function(l) {
          var h = d.get(l), u = n(e.getEvent(l));
          return h.set(u), d.trigger("scheduler:change", h), !0;
        }), e.attachEvent("onEventDeleted", function(l) {
          var h = d.get(l);
          return h && (d.trigger("scheduler:remove", h), d.remove(l)), !0;
        });
      };
    }
    function outerdrag(e) {
      e.attachEvent("onTemplatesReady", function() {
        var a, t = new dhtmlDragAndDropObject(), n = t.stopDrag;
        function o(r, d, i, s) {
          if (!e.checkEvent("onBeforeExternalDragIn") || e.callEvent("onBeforeExternalDragIn", [r, d, i, s, a])) {
            var _ = e.attachEvent("onEventCreated", function(f) {
              e.callEvent("onExternalDragIn", [f, r, a]) || (this._drag_mode = this._drag_id = null, this.deleteEvent(f));
            }), l = e.getActionData(a), h = { start_date: new Date(l.date) };
            if (e.matrix && e.matrix[e._mode]) {
              var u = e.matrix[e._mode];
              h[u.y_property] = l.section;
              var m = e._locate_cell_timeline(a);
              h.start_date = u._trace_x[m.x], h.end_date = e.date.add(h.start_date, u.x_step, u.x_unit);
            }
            e._props && e._props[e._mode] && (h[e._props[e._mode].map_to] = l.section), e.addEventNow(h), e.detachEvent(_);
          }
        }
        t.stopDrag = function(r) {
          return a = r, n.apply(this, arguments);
        }, t.addDragLanding(e._els.dhx_cal_data[0], { _drag: function(r, d, i, s) {
          o(r, d, i, s);
        }, _dragIn: function(r, d) {
          return r;
        }, _dragOut: function(r) {
          return this;
        } }), dhtmlx.DragControl && dhtmlx.DragControl.addDrop(e._els.dhx_cal_data[0], { onDrop: function(r, d, i, s) {
          var _ = dhtmlx.DragControl.getMaster(r);
          a = s, o(r, _, d, s.target || s.srcElement);
        }, onDragIn: function(r, d, i) {
          return d;
        } }, !0);
      });
    }
    function pdf(e) {
      var a, t, n = new RegExp("<[^>]*>", "g"), o = new RegExp("<br[^>]*>", "g");
      function r(x) {
        return x.replace(o, `
`).replace(n, "");
      }
      function d(x, w) {
        x = parseFloat(x), w = parseFloat(w), isNaN(w) || (x -= w);
        var k = s(x);
        return x = x - k.width + k.cols * a, isNaN(x) ? "auto" : 100 * x / a;
      }
      function i(x, w, k) {
        x = parseFloat(x), w = parseFloat(w), !isNaN(w) && k && (x -= w);
        var E = s(x);
        return x = x - E.width + E.cols * a, isNaN(x) ? "auto" : 100 * x / (a - (isNaN(w) ? 0 : w));
      }
      function s(x) {
        for (var w = 0, k = e._els.dhx_cal_header[0].childNodes, E = k[1] ? k[1].childNodes : k[0].childNodes, D = 0; D < E.length; D++) {
          var S = E[D].style ? E[D] : E[D].parentNode, N = parseFloat(S.style.width);
          if (!(x > N))
            break;
          x -= N + 1, w += N + 1;
        }
        return { width: w, cols: D };
      }
      function _(x) {
        return x = parseFloat(x), isNaN(x) ? "auto" : 100 * x / t;
      }
      function l(x, w) {
        return (window.getComputedStyle ? window.getComputedStyle(x, null)[w] : x.currentStyle ? x.currentStyle[w] : null) || "";
      }
      function h(x, w) {
        for (var k = parseInt(x.style.left, 10), E = 0; E < e._cols.length; E++)
          if ((k -= e._cols[E]) < 0)
            return E;
        return w;
      }
      function u(x, w) {
        for (var k = parseInt(x.style.top, 10), E = 0; E < e._colsS.heights.length; E++)
          if (e._colsS.heights[E] > k)
            return E;
        return w;
      }
      function m(x) {
        return x ? "</" + x + ">" : "";
      }
      function f(x, w, k, E) {
        var D = "<" + x + " profile='" + w + "'";
        return k && (D += " header='" + k + "'"), E && (D += " footer='" + E + "'"), D += ">";
      }
      function y() {
        var x = "", w = e._mode;
        if (e.matrix && e.matrix[e._mode] && (w = e.matrix[e._mode].render == "cell" ? "matrix" : "timeline"), x += "<scale mode='" + w + "' today='" + e._els.dhx_cal_date[0].innerHTML + "'>", e._mode == "week_agenda")
          for (var k = e._els.dhx_cal_data[0].getElementsByTagName("DIV"), E = 0; E < k.length; E++)
            k[E].className == "dhx_wa_scale_bar" && (x += "<column>" + r(k[E].innerHTML) + "</column>");
        else if (e._mode == "agenda" || e._mode == "map")
          x += "<column>" + r((k = e._els.dhx_cal_header[0].childNodes[0].childNodes)[0].innerHTML) + "</column><column>" + r(k[1].innerHTML) + "</column>";
        else if (e._mode == "year")
          for (k = e._els.dhx_cal_data[0].childNodes, E = 0; E < k.length; E++)
            x += "<month label='" + r(k[E].querySelector(".dhx_year_month").innerHTML) + "'>", x += c(k[E].querySelector(".dhx_year_week").childNodes), x += b(k[E].querySelector(".dhx_year_body")), x += "</month>";
        else {
          x += "<x>", x += c(k = e._els.dhx_cal_header[0].childNodes), x += "</x>";
          var D = e._els.dhx_cal_data[0];
          if (e.matrix && e.matrix[e._mode]) {
            for (x += "<y>", E = 0; E < D.firstChild.rows.length; E++)
              x += "<row><![CDATA[" + r(D.firstChild.rows[E].cells[0].innerHTML) + "]]></row>";
            x += "</y>", t = D.firstChild.rows[0].cells[0].offsetHeight;
          } else if (D.firstChild.tagName == "TABLE")
            x += b(D);
          else {
            for (D = D.childNodes[D.childNodes.length - 1]; D.className.indexOf("dhx_scale_holder") == -1; )
              D = D.previousSibling;
            for (D = D.childNodes, x += "<y>", E = 0; E < D.length; E++)
              x += `
<row><![CDATA[` + r(D[E].innerHTML) + "]]></row>";
            x += "</y>", t = D[0].offsetHeight;
          }
        }
        return x += "</scale>";
      }
      function b(x) {
        for (var w = "", k = x.querySelectorAll("tr"), E = 0; E < k.length; E++) {
          for (var D = [], S = k[E].querySelectorAll("td"), N = 0; N < S.length; N++)
            D.push(S[N].querySelector(".dhx_month_head").innerHTML);
          w += `
<row height='` + S[0].offsetHeight + "'><![CDATA[" + r(D.join("|")) + "]]></row>", t = S[0].offsetHeight;
        }
        return w;
      }
      function c(x) {
        var w, k = "";
        e.matrix && e.matrix[e._mode] && (e.matrix[e._mode].second_scale && (w = x[1].childNodes), x = x[0].childNodes);
        for (var E = 0; E < x.length; E++)
          k += `
<column><![CDATA[` + r(x[E].innerHTML) + "]]></column>";
        if (a = x[0].offsetWidth, w) {
          var D = 0, S = x[0].offsetWidth, N = 1;
          for (E = 0; E < w.length; E++)
            k += `
<column second_scale='` + N + "'><![CDATA[" + r(w[E].innerHTML) + "]]></column>", (D += w[E].offsetWidth) >= S && (S += x[N] ? x[N].offsetWidth : 0, N++), a = w[0].offsetWidth;
        }
        return k;
      }
      function g(x) {
        var w = "", k = e._rendered, E = e.matrix && e.matrix[e._mode];
        if (e._mode == "agenda" || e._mode == "map")
          for (var D = 0; D < k.length; D++)
            w += "<event><head><![CDATA[" + r(k[D].childNodes[0].innerHTML) + "]]></head><body><![CDATA[" + r(k[D].childNodes[2].innerHTML) + "]]></body></event>";
        else if (e._mode == "week_agenda")
          for (D = 0; D < k.length; D++)
            w += "<event day='" + k[D].parentNode.getAttribute("day") + "'><body>" + r(k[D].innerHTML) + "</body></event>";
        else if (e._mode == "year")
          for (k = e.get_visible_events(), D = 0; D < k.length; D++) {
            var S = k[D].start_date;
            for (S.valueOf() < e._min_date.valueOf() && (S = e._min_date); S < k[D].end_date; ) {
              var N = S.getMonth() + 12 * (S.getFullYear() - e._min_date.getFullYear()) - e.week_starts._month, A = e.week_starts[N] + S.getDate() - 1, M = x ? l(e._get_year_cell(S), "color") : "", C = x ? l(e._get_year_cell(S), "backgroundColor") : "";
              if (w += "<event day='" + A % 7 + "' week='" + Math.floor(A / 7) + "' month='" + N + "' backgroundColor='" + C + "' color='" + M + "'></event>", (S = e.date.add(S, 1, "day")).valueOf() >= e._max_date.valueOf())
                break;
            }
          }
        else if (E && E.render == "cell")
          for (k = e._els.dhx_cal_data[0].getElementsByTagName("TD"), D = 0; D < k.length; D++)
            M = x ? l(k[D], "color") : "", w += `
<event><body backgroundColor='` + (C = x ? l(k[D], "backgroundColor") : "") + "' color='" + M + "'><![CDATA[" + r(k[D].innerHTML) + "]]></body></event>";
        else
          for (D = 0; D < k.length; D++) {
            var T, O;
            if (e.matrix && e.matrix[e._mode])
              T = d(k[D].style.left), O = d(k[D].offsetWidth) - 1;
            else {
              var L = e.config.use_select_menu_space ? 0 : 26;
              T = i(k[D].style.left, L, !0), O = i(k[D].style.width, L) - 1;
            }
            if (!isNaN(1 * O)) {
              var $ = _(k[D].style.top), P = _(k[D].style.height), j = k[D].className.split(" ")[0].replace("dhx_cal_", "");
              if (j !== "dhx_tooltip_line") {
                var I = e.getEvent(k[D].getAttribute(e.config.event_attribute));
                if (I) {
                  A = I._sday;
                  var Y = I._sweek, J = I._length || 0;
                  if (e._mode == "month")
                    P = parseInt(k[D].offsetHeight, 10), $ = parseInt(k[D].style.top, 10) - e.xy.month_head_height, A = h(k[D], A), Y = u(k[D], Y);
                  else if (e.matrix && e.matrix[e._mode]) {
                    A = 0, Y = k[D].parentNode.parentNode.parentNode.rowIndex;
                    var Q = t;
                    t = k[D].parentNode.offsetHeight, $ = _(k[D].style.top), $ -= 0.2 * $, t = Q;
                  } else {
                    if (k[D].parentNode == e._els.dhx_cal_data[0])
                      continue;
                    var R = e._els.dhx_cal_data[0].childNodes[0], V = parseFloat(R.className.indexOf("dhx_scale_holder") != -1 ? R.style.left : 0);
                    T += d(k[D].parentNode.style.left, V);
                  }
                  w += `
<event week='` + Y + "' day='" + A + "' type='" + j + "' x='" + T + "' y='" + $ + "' width='" + O + "' height='" + P + "' len='" + J + "'>", j == "event" ? (w += "<header><![CDATA[" + r(k[D].childNodes[1].innerHTML) + "]]></header>", M = x ? l(k[D].childNodes[2], "color") : "", w += "<body backgroundColor='" + (C = x ? l(k[D].childNodes[2], "backgroundColor") : "") + "' color='" + M + "'><![CDATA[" + r(k[D].childNodes[2].innerHTML) + "]]></body>") : (M = x ? l(k[D], "color") : "", w += "<body backgroundColor='" + (C = x ? l(k[D], "backgroundColor") : "") + "' color='" + M + "'><![CDATA[" + r(k[D].innerHTML) + "]]></body>"), w += "</event>";
                }
              }
            }
          }
        return w;
      }
      function v(x, w, k, E, D, S) {
        var N = !1;
        E == "fullcolor" && (N = !0, E = "color"), E = E || "color";
        var A, M = "";
        if (x) {
          var C = e._date, T = e._mode;
          w = e.date[k + "_start"](w), w = e.date["get_" + k + "_end"] ? e.date["get_" + k + "_end"](w) : e.date.add(w, 1, k), M = f("pages", E, D, S);
          for (var O = new Date(x); +O < +w; O = this.date.add(O, 1, k))
            this.setCurrentView(O, k), M += ((A = "page") ? "<" + A + ">" : "") + y().replace("–", "-") + g(N) + m("page");
          M += m("pages"), this.setCurrentView(C, T);
        } else
          M = f("data", E, D, S) + y().replace("–", "-") + g(N) + m("data");
        return M;
      }
      function p(x, w, k, E, D, S, N) {
        (function(A, M) {
          var C = e.uid(), T = document.createElement("div");
          T.style.display = "none", document.body.appendChild(T), T.innerHTML = '<form id="' + C + '" method="post" target="_blank" action="' + M + '" accept-charset="utf-8" enctype="application/x-www-form-urlencoded"><input type="hidden" name="mycoolxmlbody"/> </form>', document.getElementById(C).firstChild.value = encodeURIComponent(A), document.getElementById(C).submit(), T.parentNode.removeChild(T);
        })(typeof D == "object" ? function(A) {
          for (var M = "<data>", C = 0; C < A.length; C++)
            M += A[C].source.getPDFData(A[C].start, A[C].end, A[C].view, A[C].mode, A[C].header, A[C].footer);
          return M += "</data>", M;
        }(D) : v.apply(this, [x, w, k, D, S, N]), E);
      }
      e.getPDFData = v, e.toPDF = function(x, w, k, E) {
        return p.apply(this, [null, null, null, x, w, k, E]);
      }, e.toPDFRange = function(x, w, k, E, D, S, N) {
        return typeof x == "string" && (x = e.templates.api_date(x), w = e.templates.api_date(w)), p.apply(this, arguments);
      };
    }
    function quick_info(e) {
      e.config.icons_select = ["icon_form", "icon_delete"], e.config.details_on_create = !0, e.config.show_quick_info = !0, e.xy.menu_width = 0, e.attachEvent("onClick", function(a) {
        if (e.config.show_quick_info)
          return e.showQuickInfo(a), !0;
      }), function() {
        for (var a = ["onEmptyClick", "onViewChange", "onLightbox", "onBeforeEventDelete", "onBeforeDrag"], t = function() {
          return e.hideQuickInfo(!0), !0;
        }, n = 0; n < a.length; n++)
          e.attachEvent(a[n], t);
      }(), e.templates.quick_info_title = function(a, t, n) {
        return n.text.substr(0, 50);
      }, e.templates.quick_info_content = function(a, t, n) {
        return n.details || "";
      }, e.templates.quick_info_date = function(a, t, n) {
        return e.isOneDayEvent(n) && e.config.rtl ? e.templates.day_date(a, t, n) + " " + e.templates.event_header(t, a, n) : e.isOneDayEvent(n) ? e.templates.day_date(a, t, n) + " " + e.templates.event_header(a, t, n) : e.config.rtl ? e.templates.week_date(t, a, n) : e.templates.week_date(a, t, n);
      }, e.showQuickInfo = function(a) {
        if (a != this._quick_info_box_id && (this.hideQuickInfo(!0), this.callEvent("onBeforeQuickInfo", [a]) !== !1)) {
          var t = this._get_event_counter_part(a);
          t && (this._quick_info_box = this._init_quick_info(t), this._fill_quick_data(a), this._show_quick_info(t), this.callEvent("onQuickInfo", [a]));
        }
      }, function() {
        function a(t) {
          t = t || "";
          var n, o = parseFloat(t), r = t.match(/m?s/);
          switch (r && (r = r[0]), r) {
            case "s":
              n = 1e3 * o;
              break;
            case "ms":
              n = o;
              break;
            default:
              n = 0;
          }
          return n;
        }
        e.hideQuickInfo = function(t) {
          var n = this._quick_info_box, o = this._quick_info_box_id;
          if (this._quick_info_box_id = 0, n && n.parentNode) {
            var r = n.offsetWidth;
            if (e.config.quick_info_detached)
              return this.callEvent("onAfterQuickInfo", [o]), n.parentNode.removeChild(n);
            if (n.style.right == "auto" ? n.style.left = -r + "px" : n.style.right = -r + "px", t)
              n.parentNode.removeChild(n);
            else {
              var d;
              window.getComputedStyle ? d = window.getComputedStyle(n, null) : n.currentStyle && (d = n.currentStyle);
              var i = a(d["transition-delay"]) + a(d["transition-duration"]);
              setTimeout(function() {
                n.parentNode && n.parentNode.removeChild(n);
              }, i);
            }
            this.callEvent("onAfterQuickInfo", [o]);
          }
        };
      }(), e.event(window, "keydown", function(a) {
        a.keyCode == 27 && e.hideQuickInfo();
      }), e._show_quick_info = function(a) {
        var t = e._quick_info_box;
        e._obj.appendChild(t);
        var n = t.offsetWidth, o = t.offsetHeight;
        if (e.config.quick_info_detached) {
          var r = a.left - a.dx * (n - a.width);
          e.getView() && e.getView()._x_scroll && (e.config.rtl ? r += e.getView()._x_scroll : r -= e.getView()._x_scroll), r + n > window.innerWidth && (r = window.innerWidth - n), r = Math.max(0, r), t.style.left = r + "px", t.style.top = a.top - (a.dy ? o : -a.height) + "px";
        } else {
          const d = e.$container.querySelector(".dhx_cal_data").offsetTop;
          t.style.top = d + 20 + "px", a.dx == 1 ? (t.style.right = "auto", t.style.left = -n + "px", setTimeout(function() {
            t.style.left = "-10px";
          }, 1)) : (t.style.left = "auto", t.style.right = -n + "px", setTimeout(function() {
            t.style.right = "-10px";
          }, 1)), t.className = t.className.replace(" dhx_qi_left", "").replace(" dhx_qi_right", "") + " dhx_qi_" + (a.dx == 1 ? "left" : "right");
        }
      }, e.attachEvent("onTemplatesReady", function() {
        if (e.hideQuickInfo(), this._quick_info_box) {
          var a = this._quick_info_box;
          a.parentNode && a.parentNode.removeChild(a), this._quick_info_box = null;
        }
      }), e._quick_info_onscroll_handler = function(a) {
        e.hideQuickInfo();
      }, e._init_quick_info = function() {
        if (!this._quick_info_box) {
          var a = this._quick_info_box = document.createElement("div");
          this._waiAria.quickInfoAttr(a), a.className = "dhx_cal_quick_info", e.$testmode && (a.className += " dhx_no_animate"), e.config.rtl && (a.className += " dhx_quick_info_rtl");
          var t = `
		<div class="dhx_cal_qi_tcontrols">
			<a class="dhx_cal_qi_close_btn scheduler_icon close"></a>
		</div>
		<div class="dhx_cal_qi_title" ${this._waiAria.quickInfoHeaderAttrString()}>
				
				<div class="dhx_cal_qi_tcontent"></div>
				<div class="dhx_cal_qi_tdate"></div>
			</div>
			<div class="dhx_cal_qi_content"></div>`;
          t += '<div class="dhx_cal_qi_controls">';
          for (var n = e.config.icons_select, o = 0; o < n.length; o++)
            t += `<div ${this._waiAria.quickInfoButtonAttrString(this.locale.labels[n[o]])} class="dhx_qi_big_icon ${n[o]}" title="${e.locale.labels[n[o]]}">
				<div class='dhx_menu_icon ${n[o]}'></div><div>${e.locale.labels[n[o]]}</div></div>`;
          t += "</div>", a.innerHTML = t, e.event(a, "click", function(r) {
            e._qi_button_click(r.target || r.srcElement);
          }), e.config.quick_info_detached && (e._detachDomEvent(e._els.dhx_cal_data[0], "scroll", e._quick_info_onscroll_handler), e.event(e._els.dhx_cal_data[0], "scroll", e._quick_info_onscroll_handler));
        }
        return this._quick_info_box;
      }, e._qi_button_click = function(a) {
        var t = e._quick_info_box;
        if (a && a != t)
          if (a.closest(".dhx_cal_qi_close_btn"))
            e.hideQuickInfo();
          else {
            var n = e._getClassName(a);
            if (n.indexOf("_icon") != -1) {
              var o = e._quick_info_box_id;
              e._click.buttons[n.split(" ")[1].replace("icon_", "")](o);
            } else
              e._qi_button_click(a.parentNode);
          }
      }, e._get_event_counter_part = function(a) {
        for (var t = e.getRenderedEvent(a), n = 0, o = 0, r = t; r && r != e._obj; )
          n += r.offsetLeft, o += r.offsetTop - r.scrollTop, r = r.offsetParent;
        return r ? { left: n, top: o, dx: n + t.offsetWidth / 2 > e._x / 2 ? 1 : 0, dy: o + t.offsetHeight / 2 > e._y / 2 ? 1 : 0, width: t.offsetWidth, height: t.offsetHeight } : 0;
      }, e._fill_quick_data = function(a) {
        var t = e.getEvent(a), n = e._quick_info_box;
        e._quick_info_box_id = a;
        var o = { content: e.templates.quick_info_title(t.start_date, t.end_date, t), date: e.templates.quick_info_date(t.start_date, t.end_date, t) };
        n.querySelector(".dhx_cal_qi_tcontent").innerHTML = `<span>${o.content}</span>`, n.querySelector(".dhx_cal_qi_tdate").innerHTML = o.date, e._waiAria.quickInfoHeader(n, [o.content, o.date].join(" "));
        var r = n.querySelector(".dhx_cal_qi_content");
        const d = e.templates.quick_info_content(t.start_date, t.end_date, t);
        d ? (r.classList.remove("dhx_hidden"), r.innerHTML = d) : r.classList.add("dhx_hidden");
      };
    }
    function readonly(e) {
      e.attachEvent("onTemplatesReady", function() {
        var a;
        e.form_blocks.recurring && (a = e.form_blocks.recurring.set_value);
        var t = e.config.buttons_left.slice(), n = e.config.buttons_right.slice();
        function o(i, s, _, l) {
          for (var h = s.getElementsByTagName(i), u = _.getElementsByTagName(i), m = u.length - 1; m >= 0; m--)
            if (_ = u[m], l) {
              var f = document.createElement("span");
              f.className = "dhx_text_disabled", f.innerHTML = l(h[m]), _.parentNode.insertBefore(f, _), _.parentNode.removeChild(_);
            } else
              _.disabled = !0, s.checked && (_.checked = !0);
        }
        e.attachEvent("onBeforeLightbox", function(i) {
          this.config.readonly_form || this.getEvent(i).readonly ? this.config.readonly_active = !0 : (this.config.readonly_active = !1, e.config.buttons_left = t.slice(), e.config.buttons_right = n.slice(), e.form_blocks.recurring && (e.form_blocks.recurring.set_value = a));
          var s = this.config.lightbox.sections;
          if (this.config.readonly_active) {
            for (var _ = 0; _ < s.length; _++)
              s[_].type == "recurring" && this.config.readonly_active && e.form_blocks.recurring && (e.form_blocks.recurring.set_value = function(c, g, v) {
                var p = e.$domHelpers.closest(c, ".dhx_wrap_section"), x = "none";
                p.querySelector(".dhx_cal_lsection").display = x, p.querySelector(".dhx_form_repeat").display = x, p.style.display = x, e.setLightboxSize();
              });
            var l = ["dhx_delete_btn", "dhx_save_btn"], h = [e.config.buttons_left, e.config.buttons_right];
            for (_ = 0; _ < l.length; _++)
              for (var u = l[_], m = 0; m < h.length; m++) {
                for (var f = h[m], y = -1, b = 0; b < f.length; b++)
                  if (f[b] == u) {
                    y = b;
                    break;
                  }
                y != -1 && f.splice(y, 1);
              }
          }
          return this.resetLightbox(), !0;
        });
        var r = e._fill_lightbox;
        e._fill_lightbox = function() {
          var i = this.getLightbox();
          this.config.readonly_active && (i.style.visibility = "hidden", i.style.display = "block");
          var s = r.apply(this, arguments);
          if (this.config.readonly_active && (i.style.visibility = "", i.style.display = "none"), this.config.readonly_active) {
            var _ = this.getLightbox(), l = this._lightbox_r = _.cloneNode(!0);
            l.id = e.uid(), l.className += " dhx_cal_light_readonly", o("textarea", _, l, function(h) {
              return h.value;
            }), o("input", _, l, !1), o("select", _, l, function(h) {
              return h.options.length ? h.options[Math.max(h.selectedIndex || 0, 0)].text : "";
            }), _.parentNode.insertBefore(l, _), this.showCover(l), e._lightbox && e._lightbox.parentNode.removeChild(e._lightbox), this._lightbox = l, e.config.drag_lightbox && e.event(l.firstChild, "mousedown", e._ready_to_dnd), e._init_lightbox_events(), this.setLightboxSize();
          }
          return s;
        };
        var d = e.hide_lightbox;
        e.hide_lightbox = function() {
          return this._lightbox_r && (this._lightbox_r.parentNode.removeChild(this._lightbox_r), this._lightbox_r = this._lightbox = null), d.apply(this, arguments);
        };
      });
    }
    function recurring(e) {
      function a() {
        var r = e.formSection("recurring");
        if (r || (r = t("recurring")), !r)
          throw new Error(["Can't locate the Recurring form section.", "Make sure that you have the recurring control on the lightbox configuration https://docs.dhtmlx.com/scheduler/recurring_events.html#recurringlightbox ", 'and that the recurring control has name "recurring":', "", "scheduler.config.lightbox.sections = [", '	{name:"recurring", ... }', "];"].join(`
`));
        return r;
      }
      function t(r) {
        for (var d = 0; d < e.config.lightbox.sections.length; d++) {
          var i = e.config.lightbox.sections[d];
          if (i.type === r)
            return e.formSection(i.name);
        }
        return null;
      }
      function n(r) {
        return new Date(r.getFullYear(), r.getMonth(), r.getDate(), r.getHours(), r.getMinutes(), r.getSeconds(), 0);
      }
      var o;
      e.config.occurrence_timestamp_in_utc = !1, e.config.recurring_workdays = [1, 2, 3, 4, 5], e.form_blocks.recurring = { _get_node: function(r) {
        if (typeof r == "string") {
          let d = e._lightbox.querySelector(`#${r}`);
          d || (d = document.getElementById(r)), r = d;
        }
        return r.style.display == "none" && (r.style.display = ""), r;
      }, _outer_html: function(r) {
        return r.outerHTML || (d = r, (s = document.createElement("div")).appendChild(d.cloneNode(!0)), i = s.innerHTML, s = null, i);
        var d, i, s;
      }, render: function(r) {
        if (r.form) {
          var d = e.form_blocks.recurring, i = d._get_node(r.form), s = d._outer_html(i);
          return i.style.display = "none", s;
        }
        var _ = e.locale.labels;
        return '<div class="dhx_form_repeat"> <form> <div class="dhx_repeat_left"> <div><label><input class="dhx_repeat_radio" type="radio" name="repeat" value="day" />' + _.repeat_radio_day + '</label></div> <div><label><input class="dhx_repeat_radio" type="radio" name="repeat" value="week"/>' + _.repeat_radio_week + '</label></div> <div><label><input class="dhx_repeat_radio" type="radio" name="repeat" value="month" checked />' + _.repeat_radio_month + '</label></div> <div><label><input class="dhx_repeat_radio" type="radio" name="repeat" value="year" />' + _.repeat_radio_year + '</label></div> </div> <div class="dhx_repeat_divider"></div> <div class="dhx_repeat_center"> <div style="display:none;" id="dhx_repeat_day"> <div><label><input class="dhx_repeat_radio" type="radio" name="day_type" value="d"/>' + _.repeat_radio_day_type + '</label><label><input class="dhx_repeat_text" type="text" name="day_count" value="1" />' + _.repeat_text_day_count + '</label></div> <div><label><input class="dhx_repeat_radio" type="radio" name="day_type" checked value="w"/>' + _.repeat_radio_day_type2 + '</label></div> </div> <div style="display:none;" id="dhx_repeat_week"><div><label>' + _.repeat_week + '<input class="dhx_repeat_text" type="text" name="week_count" value="1" /></label><span>' + _.repeat_text_week_count + '</span></div>  <table class="dhx_repeat_days"> <tr> <td><div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="1" />' + _.day_for_recurring[1] + '</label></div> <div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="4" />' + _.day_for_recurring[4] + '</label></div></td> <td><div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="2" />' + _.day_for_recurring[2] + '</label></div> <div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="5" />' + _.day_for_recurring[5] + '</label></div></td> <td><div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="3" />' + _.day_for_recurring[3] + '</label></div> <div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="6" />' + _.day_for_recurring[6] + '</label></div></td> <td><div><label><input class="dhx_repeat_checkbox" type="checkbox" name="week_day" value="0" />' + _.day_for_recurring[0] + '</label></div> </td> </tr> </table> </div> <div id="dhx_repeat_month"> <div><label class = "dhx_repeat_month_label"><input class="dhx_repeat_radio" type="radio" name="month_type" value="d"/>' + _.repeat_radio_month_type + '</label><label><input class="dhx_repeat_text" type="text" name="month_day" value="1" />' + _.repeat_text_month_day + '</label><label><input class="dhx_repeat_text" type="text" name="month_count" value="1" />' + _.repeat_text_month_count + '</label></div> <div><label class = "dhx_repeat_month_label"><input class="dhx_repeat_radio" type="radio" name="month_type" checked value="w"/>' + _.repeat_radio_month_start + '</label><input class="dhx_repeat_text" type="text" name="month_week2" value="1" /><label><select name="month_day2">	<option value="1" selected >' + e.locale.date.day_full[1] + '<option value="2">' + e.locale.date.day_full[2] + '<option value="3">' + e.locale.date.day_full[3] + '<option value="4">' + e.locale.date.day_full[4] + '<option value="5">' + e.locale.date.day_full[5] + '<option value="6">' + e.locale.date.day_full[6] + '<option value="0">' + e.locale.date.day_full[0] + "</select>" + _.repeat_text_month_count2_before + '</label><label><input class="dhx_repeat_text" type="text" name="month_count2" value="1" />' + _.repeat_text_month_count2_after + '</label></div> </div> <div style="display:none;" id="dhx_repeat_year"> <div><label class = "dhx_repeat_year_label"><input class="dhx_repeat_radio" type="radio" name="year_type" value="d"/>' + _.repeat_radio_day_type + '</label><label><input class="dhx_repeat_text" type="text" name="year_day" value="1" />' + _.repeat_text_year_day + '</label><label><select name="year_month"><option value="0" selected >' + _.month_for_recurring[0] + '<option value="1">' + _.month_for_recurring[1] + '<option value="2">' + _.month_for_recurring[2] + '<option value="3">' + _.month_for_recurring[3] + '<option value="4">' + _.month_for_recurring[4] + '<option value="5">' + _.month_for_recurring[5] + '<option value="6">' + _.month_for_recurring[6] + '<option value="7">' + _.month_for_recurring[7] + '<option value="8">' + _.month_for_recurring[8] + '<option value="9">' + _.month_for_recurring[9] + '<option value="10">' + _.month_for_recurring[10] + '<option value="11">' + _.month_for_recurring[11] + "</select>" + _.select_year_month + '</label></div> <div><label class = "dhx_repeat_year_label"><input class="dhx_repeat_radio" type="radio" name="year_type" checked value="w"/>' + _.repeat_year_label + '</label><input class="dhx_repeat_text" type="text" name="year_week2" value="1" /><select name="year_day2"><option value="1" selected >' + e.locale.date.day_full[1] + '<option value="2">' + e.locale.date.day_full[2] + '<option value="3">' + e.locale.date.day_full[3] + '<option value="4">' + e.locale.date.day_full[4] + '<option value="5">' + e.locale.date.day_full[5] + '<option value="6">' + e.locale.date.day_full[6] + '<option value="7">' + e.locale.date.day_full[0] + "</select>" + _.select_year_day2 + '<select name="year_month2"><option value="0" selected >' + _.month_for_recurring[0] + '<option value="1">' + _.month_for_recurring[1] + '<option value="2">' + _.month_for_recurring[2] + '<option value="3">' + _.month_for_recurring[3] + '<option value="4">' + _.month_for_recurring[4] + '<option value="5">' + _.month_for_recurring[5] + '<option value="6">' + _.month_for_recurring[6] + '<option value="7">' + _.month_for_recurring[7] + '<option value="8">' + _.month_for_recurring[8] + '<option value="9">' + _.month_for_recurring[9] + '<option value="10">' + _.month_for_recurring[10] + '<option value="11">' + _.month_for_recurring[11] + '</select></div> </div> </div> <div class="dhx_repeat_divider"></div> <div class="dhx_repeat_right"> <div><label><input class="dhx_repeat_radio" type="radio" name="end" checked/>' + _.repeat_radio_end + '</label></div> <div><label><input class="dhx_repeat_radio" type="radio" name="end" />' + _.repeat_radio_end2 + '</label><input class="dhx_repeat_text" type="text" name="occurences_count" value="1" />' + _.repeat_text_occurences_count + '</div> <div><label><input class="dhx_repeat_radio" type="radio" name="end" />' + _.repeat_radio_end3 + '</label><input class="dhx_repeat_date" type="text" name="date_of_end" value="' + e.config.repeat_date_of_end + '" /></div> </div> </form> </div> </div>';
      }, _ds: {}, _get_form_node: function(r, d, i) {
        var s = r[d];
        if (!s)
          return null;
        if (s.nodeName)
          return s;
        if (s.length) {
          for (var _ = 0; _ < s.length; _++)
            if (s[_].value == i)
              return s[_];
        }
      }, _get_node_value: function(r, d, i) {
        var s = r[d];
        if (!s)
          return "";
        if (s.length) {
          if (i) {
            for (var _ = [], l = 0; l < s.length; l++)
              s[l].checked && _.push(s[l].value);
            return _;
          }
          for (l = 0; l < s.length; l++)
            if (s[l].checked)
              return s[l].value;
        }
        return s.value ? i ? [s.value] : s.value : void 0;
      }, _get_node_numeric_value: function(r, d) {
        return 1 * e.form_blocks.recurring._get_node_value(r, d) || 0;
      }, _set_node_value: function(r, d, i) {
        var s = r[d];
        if (s) {
          if (s.name == d)
            s.value = i;
          else if (s.length)
            for (var _ = typeof i == "object", l = 0; l < s.length; l++)
              (_ || s[l].value == i) && (s[l].checked = _ ? !!i[s[l].value] : !!i);
        }
      }, _init_set_value: function(r, d, i) {
        var s = e.form_blocks.recurring, _ = s._get_node_value, l = s._set_node_value;
        e.form_blocks.recurring._ds = { start: i.start_date, end: i._end_date };
        var h = e.date.str_to_date(e.config.repeat_date, !1, !0), u = e.date.date_to_str(e.config.repeat_date), m = r.getElementsByTagName("FORM")[0], f = {};
        function y(E) {
          for (var D = 0; D < E.length; D++) {
            var S = E[D];
            if (S.name)
              if (f[S.name])
                if (f[S.name].nodeType) {
                  var N = f[S.name];
                  f[S.name] = [N, S];
                } else
                  f[S.name].push(S);
              else
                f[S.name] = S;
          }
        }
        if (y(m.getElementsByTagName("INPUT")), y(m.getElementsByTagName("SELECT")), !e.config.repeat_date_of_end) {
          var b = e.date.date_to_str(e.config.repeat_date);
          e.config.repeat_date_of_end = b(e.date.add(e._currentDate(), 30, "day"));
        }
        l(f, "date_of_end", e.config.repeat_date_of_end);
        var c = function(E) {
          return e._lightbox.querySelector(`#${E}`) || { style: {} };
        };
        function g() {
          c("dhx_repeat_day").style.display = "none", c("dhx_repeat_week").style.display = "none", c("dhx_repeat_month").style.display = "none", c("dhx_repeat_year").style.display = "none", c("dhx_repeat_" + this.value).style.display = "", e.setLightboxSize();
        }
        function v(E, D) {
          var S = E.end;
          if (S.length)
            if (S[0].value && S[0].value != "on")
              for (var N = 0; N < S.length; N++)
                S[N].value == D && (S[N].checked = !0);
            else {
              var A = 0;
              switch (D) {
                case "no":
                  A = 0;
                  break;
                case "date_of_end":
                  A = 2;
                  break;
                default:
                  A = 1;
              }
              S[A].checked = !0;
            }
          else
            S.value = D;
        }
        e.form_blocks.recurring._get_repeat_code = function(E) {
          var D = [_(f, "repeat")];
          for (p[D[0]](D, E); D.length < 5; )
            D.push("");
          var S = "", N = function(A) {
            var M = A.end;
            if (M.length) {
              for (var C = 0; C < M.length; C++)
                if (M[C].checked)
                  return M[C].value && M[C].value != "on" ? M[C].value : C ? C == 2 ? "date_of_end" : "occurences_count" : "no";
            } else if (M.value)
              return M.value;
            return "no";
          }(f);
          return N == "no" ? (E.end = new Date(9999, 1, 1), S = "no") : N == "date_of_end" ? E.end = function(A) {
            var M = h(A);
            return e.config.include_end_by && (M = e.date.add(M, 1, "day")), M;
          }(_(f, "date_of_end")) : (e.transpose_type(D.join("_")), S = Math.max(1, _(f, "occurences_count")), E.end = e.date["add_" + D.join("_")](new Date(E.start), S + 0, { start_date: E.start }) || E.start), D.join("_") + "#" + S;
        };
        var p = { month: function(E, D) {
          var S = e.form_blocks.recurring._get_node_value, N = e.form_blocks.recurring._get_node_numeric_value;
          S(f, "month_type") == "d" ? (E.push(Math.max(1, N(f, "month_count"))), D.start.setDate(S(f, "month_day"))) : (E.push(Math.max(1, N(f, "month_count2"))), E.push(S(f, "month_day2")), E.push(Math.max(1, N(f, "month_week2"))), e.config.repeat_precise || D.start.setDate(1)), D._start = !0;
        }, week: function(E, D) {
          var S = e.form_blocks.recurring._get_node_value, N = e.form_blocks.recurring._get_node_numeric_value;
          E.push(Math.max(1, N(f, "week_count"))), E.push(""), E.push("");
          for (var A = [], M = S(f, "week_day", !0), C = D.start.getDay(), T = !1, O = 0; O < M.length; O++)
            A.push(M[O]), T = T || M[O] == C;
          A.length || (A.push(C), T = !0), A.sort(), e.config.repeat_precise ? T || (e.transpose_day_week(D.start, A, 1, 7), D._start = !0) : (D.start = e.date.week_start(D.start), D._start = !0), E.push(A.join(","));
        }, day: function(E) {
          var D = e.form_blocks.recurring._get_node_value, S = e.form_blocks.recurring._get_node_numeric_value;
          D(f, "day_type") == "d" ? E.push(Math.max(1, S(f, "day_count"))) : (E.push("week"), E.push(1), E.push(""), E.push(""), E.push(e.config.recurring_workdays.join(",")), E.splice(0, 1));
        }, year: function(E, D) {
          var S = e.form_blocks.recurring._get_node_value;
          S(f, "year_type") == "d" ? (E.push("1"), D.start.setMonth(0), D.start.setDate(S(f, "year_day")), D.start.setMonth(S(f, "year_month"))) : (E.push("1"), E.push(S(f, "year_day2")), E.push(S(f, "year_week2")), D.start.setDate(1), D.start.setMonth(S(f, "year_month2"))), D._start = !0;
        } }, x = { week: function(E, D) {
          var S = e.form_blocks.recurring._set_node_value;
          S(f, "week_count", E[1]);
          for (var N = E[4].split(","), A = {}, M = 0; M < N.length; M++)
            A[N[M]] = !0;
          S(f, "week_day", A);
        }, month: function(E, D) {
          var S = e.form_blocks.recurring._set_node_value;
          E[2] === "" ? (S(f, "month_type", "d"), S(f, "month_count", E[1]), S(f, "month_day", D.start.getDate())) : (S(f, "month_type", "w"), S(f, "month_count2", E[1]), S(f, "month_week2", E[3]), S(f, "month_day2", E[2]));
        }, day: function(E, D) {
          var S = e.form_blocks.recurring._set_node_value;
          S(f, "day_type", "d"), S(f, "day_count", E[1]);
        }, year: function(E, D) {
          var S = e.form_blocks.recurring._set_node_value;
          E[2] === "" ? (S(f, "year_type", "d"), S(f, "year_day", D.start.getDate()), S(f, "year_month", D.start.getMonth())) : (S(f, "year_type", "w"), S(f, "year_week2", E[3]), S(f, "year_day2", E[2]), S(f, "year_month2", D.start.getMonth()));
        } };
        e.form_blocks.recurring._set_repeat_code = function(E, D) {
          var S = e.form_blocks.recurring._set_node_value, N = E.split("#");
          switch (E = N[0].split("_"), x[E[0]](E, D), N[1]) {
            case "no":
              v(f, "no");
              break;
            case "":
              v(f, "date_of_end");
              var A = D.end;
              e.config.include_end_by && (A = e.date.add(A, -1, "day")), S(f, "date_of_end", u(A));
              break;
            default:
              v(f, "occurences_count"), S(f, "occurences_count", N[1]);
          }
          S(f, "repeat", E[0]);
          var M = e.form_blocks.recurring._get_form_node(f, "repeat", E[0]);
          M.nodeName == "SELECT" ? (M.dispatchEvent(new Event("change")), M.dispatchEvent(new MouseEvent("click"))) : M.dispatchEvent(new MouseEvent("click"));
        };
        for (var w = 0; w < m.elements.length; w++) {
          var k = m.elements[w];
          k.name === "repeat" && (k.nodeName != "SELECT" || k.$_eventAttached ? k.$_eventAttached || (k.$_eventAttached = !0, k.addEventListener("click", g)) : (k.$_eventAttached = !0, k.addEventListener("change", g)));
        }
        e._lightbox._rec_init_done = !0;
      }, set_value: function(r, d, i) {
        var s = e.form_blocks.recurring;
        e._lightbox._rec_init_done || s._init_set_value(r, d, i), r.open = !i.rec_type, r.blocked = this._is_modified_occurence(i);
        var _ = s._ds;
        _.start = i.start_date, _.end = i._end_date, s._toggle_block(), d && s._set_repeat_code(d, _);
      }, get_value: function(r, d) {
        if (r.open) {
          var i = e.form_blocks.recurring._ds, s = {};
          ((function() {
            var _ = e.formSection("time");
            if (_ || (_ = t("time")), _ || (_ = t("calendar_time")), !_)
              throw new Error(["Can't calculate the recurring rule, the Recurring form block can't find the Time control. Make sure you have the time control in 'scheduler.config.lightbox.sections' config.", "You can use either the default time control https://docs.dhtmlx.com/scheduler/time.html, or the datepicker https://docs.dhtmlx.com/scheduler/minicalendar.html, or a custom control. ", 'In the latter case, make sure the control is named "time":', "", "scheduler.config.lightbox.sections = [", '{name:"time", height:72, type:"YOU CONTROL", map_to:"auto" }];'].join(`
`));
            return _;
          }))().getValue(s), i.start = s.start_date, d.rec_type = e.form_blocks.recurring._get_repeat_code(i), i._start ? (d.start_date = new Date(i.start), d._start_date = new Date(i.start), i._start = !1) : d._start_date = null, d._end_date = i.end, d.rec_pattern = d.rec_type.split("#")[0];
        } else
          d.rec_type = d.rec_pattern = "", d._end_date = d.end_date;
        return d.rec_type;
      }, _get_button: function() {
        return a().header.firstChild.firstChild;
      }, _get_form: function() {
        return a().node;
      }, open: function() {
        var r = e.form_blocks.recurring;
        r._get_form().open || r._toggle_block();
      }, close: function() {
        var r = e.form_blocks.recurring;
        r._get_form().open && r._toggle_block();
      }, _toggle_block: function() {
        var r = e.form_blocks.recurring, d = r._get_form(), i = r._get_button();
        d.open || d.blocked ? (d.style.height = "0px", i && (i.style.backgroundPosition = "-5px 20px", i.nextSibling.innerHTML = e.locale.labels.button_recurring)) : (d.style.height = "auto", i && (i.style.backgroundPosition = "-5px 0px", i.nextSibling.innerHTML = e.locale.labels.button_recurring_open)), d.open = !d.open, e.setLightboxSize();
      }, focus: function(r) {
      }, button_click: function(r, d, i) {
        e.form_blocks.recurring._get_form().blocked || e.form_blocks.recurring._toggle_block();
      } }, e._rec_markers = {}, e._rec_markers_pull = {}, e._add_rec_marker = function(r, d) {
        r._pid_time = d, this._rec_markers[r.id] = r, this._rec_markers_pull[r.event_pid] || (this._rec_markers_pull[r.event_pid] = {}), this._rec_markers_pull[r.event_pid][d] = r;
      }, e._get_rec_marker = function(r, d) {
        var i = this._rec_markers_pull[d];
        return i ? i[r] : null;
      }, e._get_rec_markers = function(r) {
        return this._rec_markers_pull[r] || [];
      }, e._rec_temp = [], o = e.addEvent, e.addEvent = function(r, d, i, s, _) {
        var l = o.apply(this, arguments);
        if (l && e.getEvent(l)) {
          var h = e.getEvent(l);
          h.start_date && (h.start_date = n(h.start_date)), h.end_date && (h.end_date = n(h.end_date)), this._is_modified_occurence(h) && e._add_rec_marker(h, 1e3 * h.event_length), h.rec_type && (h.rec_pattern = h.rec_type.split("#")[0]);
        }
        return l;
      }, e.attachEvent("onEventIdChange", function(r, d) {
        if (!this._ignore_call) {
          this._ignore_call = !0, e._rec_markers[r] && (e._rec_markers[d] = e._rec_markers[r], delete e._rec_markers[r]), e._rec_markers_pull[r] && (e._rec_markers_pull[d] = e._rec_markers_pull[r], delete e._rec_markers_pull[r]);
          for (var i = 0; i < this._rec_temp.length; i++)
            (s = this._rec_temp[i]).event_pid == r && (s.event_pid = d, this.changeEventId(s.id, d + "#" + s.id.split("#")[1]));
          for (var i in this._rec_markers) {
            var s;
            (s = this._rec_markers[i]).event_pid == r && (s.event_pid = d, s._pid_changed = !0);
          }
          var _ = e._rec_markers[d];
          _ && _._pid_changed && (delete _._pid_changed, setTimeout(function() {
            if (e.$destroyed)
              return !0;
            e.callEvent("onEventChanged", [d, e.getEvent(d)]);
          }, 1)), delete this._ignore_call;
        }
      }), e.attachEvent("onConfirmedBeforeEventDelete", function(r) {
        var d = this.getEvent(r);
        if (this._is_virtual_event(r) || this._is_modified_occurence(d) && d.rec_type && d.rec_type != "none") {
          r = r.split("#");
          var i = this.uid(), s = r[1] ? r[1] : Math.round(d._pid_time / 1e3), _ = this._copy_event(d);
          _.id = i, _.event_pid = d.event_pid || r[0];
          var l = s;
          _.event_length = l, _.rec_type = _.rec_pattern = "none", this.addEvent(_), this._add_rec_marker(_, 1e3 * l);
        } else {
          d.rec_type && this._lightbox_id && this._roll_back_dates(d);
          var h = this._get_rec_markers(r);
          for (var u in h)
            h.hasOwnProperty(u) && (r = h[u].id, this.getEvent(r) && this.deleteEvent(r, !0));
        }
        return !0;
      }), e.attachEvent("onEventDeleted", function(r, d) {
        !this._is_virtual_event(r) && this._is_modified_occurence(d) && (e._events[r] || (d.rec_type = d.rec_pattern = "none", this.setEvent(r, d)));
      }), e.attachEvent("onEventChanged", function(r, d) {
        if (this._loading)
          return !0;
        var i = this.getEvent(r);
        if (this._is_virtual_event(r)) {
          r = r.split("#");
          var s = this.uid();
          this._not_render = !0;
          var _ = this._copy_event(d);
          _.id = s, _.event_pid = r[0];
          var l = r[1];
          _.event_length = l, _.rec_type = _.rec_pattern = "", this._add_rec_marker(_, 1e3 * l), this.addEvent(_), this._not_render = !1;
        } else {
          i.start_date && (i.start_date = n(i.start_date)), i.end_date && (i.end_date = n(i.end_date)), i.rec_type && this._lightbox_id && this._roll_back_dates(i);
          var h = this._get_rec_markers(r);
          for (var u in h)
            h.hasOwnProperty(u) && (delete this._rec_markers[h[u].id], this.deleteEvent(h[u].id, !0));
          delete this._rec_markers_pull[r];
          for (var m = !1, f = 0; f < this._rendered.length; f++)
            this._rendered[f].getAttribute(this.config.event_attribute) == r && (m = !0);
          m || (this._select_id = null);
        }
        return !0;
      }), e.attachEvent("onEventAdded", function(r) {
        if (!this._loading) {
          var d = this.getEvent(r);
          d.rec_type && !d.event_length && this._roll_back_dates(d);
        }
        return !0;
      }), e.attachEvent("onEventSave", function(r, d, i) {
        return this.getEvent(r).rec_type || !d.rec_type || this._is_virtual_event(r) || (this._select_id = null), !0;
      }), e.attachEvent("onEventCreated", function(r) {
        var d = this.getEvent(r);
        return d.rec_type || (d.rec_type = d.rec_pattern = d.event_length = d.event_pid = ""), !0;
      }), e.attachEvent("onEventCancel", function(r) {
        var d = this.getEvent(r);
        d.rec_type && (this._roll_back_dates(d), this.render_view_data());
      }), e._roll_back_dates = function(r) {
        r.start_date && (r.start_date = n(r.start_date)), r.end_date && (r.end_date = n(r.end_date)), r.event_length = Math.round((r.end_date.valueOf() - r.start_date.valueOf()) / 1e3), r.end_date = r._end_date, r._start_date && (r.start_date.setMonth(0), r.start_date.setDate(r._start_date.getDate()), r.start_date.setMonth(r._start_date.getMonth()), r.start_date.setFullYear(r._start_date.getFullYear()));
      }, e._is_virtual_event = function(r) {
        return r.toString().indexOf("#") != -1;
      }, e._is_modified_occurence = function(r) {
        return r.event_pid && r.event_pid != "0";
      }, e.showLightbox_rec = e.showLightbox, e.showLightbox = function(r) {
        var d = this.locale, i = e.config.lightbox_recurring, s = this.getEvent(r), _ = s.event_pid, l = this._is_virtual_event(r);
        l && (_ = r.split("#")[0]);
        var h = function(m) {
          var f = e.getEvent(m);
          return f._end_date = f.end_date, f.end_date = new Date(f.start_date.valueOf() + 1e3 * f.event_length), e.showLightbox_rec(m);
        };
        if ((_ || 1 * _ == 0) && s.rec_type)
          return h(r);
        if (!_ || _ === "0" || !d.labels.confirm_recurring || i == "instance" || i == "series" && !l)
          return this.showLightbox_rec(r);
        if (i == "ask") {
          var u = this;
          e.modalbox({ text: d.labels.confirm_recurring, title: d.labels.title_confirm_recurring, width: "500px", position: "middle", buttons: [d.labels.button_edit_series, d.labels.button_edit_occurrence, d.labels.icon_cancel], callback: function(m) {
            switch (+m) {
              case 0:
                return h(_);
              case 1:
                return u.showLightbox_rec(r);
              case 2:
                return;
            }
          } });
        } else
          h(_);
      }, e.get_visible_events_rec = e.get_visible_events, e.get_visible_events = function(r) {
        for (var d = 0; d < this._rec_temp.length; d++)
          delete this._events[this._rec_temp[d].id];
        this._rec_temp = [];
        var i = this.get_visible_events_rec(r), s = [];
        for (d = 0; d < i.length; d++)
          i[d].rec_type ? i[d].rec_pattern != "none" && this.repeat_date(i[d], s) : s.push(i[d]);
        return s;
      }, function() {
        var r = e.isOneDayEvent;
        e.isOneDayEvent = function(i) {
          return !!i.rec_type || r.call(this, i);
        };
        var d = e.updateEvent;
        e.updateEvent = function(i) {
          var s = e.getEvent(i);
          s && s.rec_type && (s.rec_pattern = (s.rec_type || "").split("#")[0]), s && s.rec_type && !this._is_virtual_event(i) ? e.update_view() : d.call(this, i);
        };
      }(), e.transponse_size = { day: 1, week: 7, month: 1, year: 12 }, e.date.day_week = function(r, d, i) {
        r.setDate(1);
        var s = e.date.month_start(new Date(r)), _ = 1 * d + (i = 7 * (i - 1)) - r.getDay() + 1;
        r.setDate(_ <= i ? _ + 7 : _);
        var l = e.date.month_start(new Date(r));
        return s.valueOf() === l.valueOf();
      }, e.transpose_day_week = function(r, d, i, s, _) {
        for (var l = (r.getDay() || (e.config.start_on_monday ? 7 : 0)) - i, h = 0; h < d.length; h++)
          if (d[h] > l)
            return r.setDate(r.getDate() + 1 * d[h] - l - (s ? i : _));
        this.transpose_day_week(r, d, i + s, null, i);
      }, e.transpose_type = function(r) {
        var d = "transpose_" + r;
        if (!this.date[d]) {
          var i = r.split("_"), s = "add_" + r, _ = this.transponse_size[i[0]] * i[1];
          if (i[0] == "day" || i[0] == "week") {
            var l = null;
            if (i[4] && (l = i[4].split(","), e.config.start_on_monday)) {
              for (var h = 0; h < l.length; h++)
                l[h] = 1 * l[h] || 7;
              l.sort();
            }
            this.date[d] = function(u, m) {
              var f = Math.floor((m.valueOf() - u.valueOf()) / (864e5 * _));
              return f > 0 && u.setDate(u.getDate() + f * _), l && e.transpose_day_week(u, l, 1, _), u;
            }, this.date[s] = function(u, m) {
              var f = new Date(u.valueOf());
              if (l)
                for (var y = 0; y < m; y++)
                  e.transpose_day_week(f, l, 0, _);
              else
                f.setDate(f.getDate() + m * _);
              return f;
            };
          } else
            i[0] != "month" && i[0] != "year" || (this.date[d] = function(u, m, f) {
              var y = Math.ceil((12 * m.getFullYear() + 1 * m.getMonth() + 1 - (12 * u.getFullYear() + 1 * u.getMonth() + 1)) / _ - 1);
              return y >= 0 && (u.setDate(1), u.setMonth(u.getMonth() + y * _)), e.date[s](u, 0, f);
            }, this.date[s] = function(u, m, f, y) {
              if (y ? y++ : y = 1, y > 12)
                return null;
              var b = new Date(u.valueOf());
              b.setDate(1), b.setMonth(b.getMonth() + m * _);
              var c = b.getMonth(), g = b.getFullYear();
              b.setDate(f.start_date.getDate()), i[3] && e.date.day_week(b, i[2], i[3]);
              var v = e.config.recurring_overflow_instances;
              return b.getMonth() != c && v != "none" && (b = v === "lastDay" ? new Date(g, c + 1, 0, b.getHours(), b.getMinutes(), b.getSeconds(), b.getMilliseconds()) : e.date[s](new Date(g, c + 1, 0), m || 1, f, y)), b;
            });
        }
      }, e.repeat_date = function(r, d, i, s, _, l) {
        s = s || this._min_date, _ = _ || this._max_date;
        var h = l || -1, u = new Date(r.start_date.valueOf()), m = u.getHours(), f = 0;
        for (!r.rec_pattern && r.rec_type && (r.rec_pattern = r.rec_type.split("#")[0]), this.transpose_type(r.rec_pattern), u = e.date["transpose_" + r.rec_pattern](u, s, r); u && (u < r.start_date || e._fix_daylight_saving_date(u, s, r, u, new Date(u.valueOf() + 1e3 * r.event_length)).valueOf() <= s.valueOf() || u.valueOf() + 1e3 * r.event_length <= s.valueOf()); )
          u = this.date["add_" + r.rec_pattern](u, 1, r);
        for (; u && u < _ && u < r.end_date && (h < 0 || f < h); ) {
          u.setHours(m);
          var y = e.config.occurrence_timestamp_in_utc ? Date.UTC(u.getFullYear(), u.getMonth(), u.getDate(), u.getHours(), u.getMinutes(), u.getSeconds()) : u.valueOf(), b = this._get_rec_marker(y, r.id);
          if (b)
            i && (b.rec_type != "none" && f++, d.push(b));
          else {
            var c = new Date(u.valueOf() + 1e3 * r.event_length), g = this._copy_event(r);
            if (g.text = r.text, g.start_date = u, g.event_pid = r.id, g.id = r.id + "#" + Math.round(y / 1e3), g.end_date = c, g.end_date = e._fix_daylight_saving_date(g.start_date, g.end_date, r, u, g.end_date), g._timed = this.isOneDayEvent(g), !g._timed && !this._table_view && !this.config.multi_day)
              return;
            d.push(g), i || (this._events[g.id] = g, this._rec_temp.push(g)), f++;
          }
          u = this.date["add_" + r.rec_pattern](u, 1, r);
        }
      }, e._fix_daylight_saving_date = function(r, d, i, s, _) {
        var l = r.getTimezoneOffset() - d.getTimezoneOffset();
        return l ? l > 0 ? new Date(s.valueOf() + 1e3 * i.event_length - 60 * l * 1e3) : new Date(d.valueOf() - 60 * l * 1e3) : new Date(_.valueOf());
      }, e.getRecDates = function(r, d) {
        var i = typeof r == "object" ? r : e.getEvent(r), s = [];
        if (d = d || 100, !i.rec_type)
          return [{ start_date: i.start_date, end_date: i.end_date }];
        if (i.rec_type == "none")
          return [];
        e.repeat_date(i, s, !0, i.start_date, i.end_date, d);
        for (var _ = [], l = 0; l < s.length; l++)
          s[l].rec_type != "none" && _.push({ start_date: s[l].start_date, end_date: s[l].end_date });
        return _;
      }, e.getEvents = function(r, d) {
        var i = [];
        for (var s in this._events) {
          var _ = this._events[s];
          if (_ && _.start_date < d && _.end_date > r)
            if (_.rec_pattern) {
              if (_.rec_pattern == "none")
                continue;
              var l = [];
              this.repeat_date(_, l, !0, r, d);
              for (var h = 0; h < l.length; h++)
                !l[h].rec_pattern && l[h].start_date < d && l[h].end_date > r && !this._rec_markers[l[h].id] && i.push(l[h]);
            } else
              this._is_virtual_event(_.id) || i.push(_);
        }
        return i;
      }, e.config.repeat_date = "%m.%d.%Y", e.config.lightbox.sections = [{ name: "description", map_to: "text", type: "textarea", focus: !0 }, { name: "recurring", type: "recurring", map_to: "rec_type", button: "recurring" }, { name: "time", height: 72, type: "time", map_to: "auto" }], e._copy_dummy = function(r) {
        var d = new Date(this.start_date), i = new Date(this.end_date);
        this.start_date = d, this.end_date = i, this.event_length = this.event_pid = this.rec_pattern = this.rec_type = null;
      }, e.config.include_end_by = !1, e.config.lightbox_recurring = "ask", e.attachEvent("onClearAll", function() {
        e._rec_markers = {}, e._rec_markers_pull = {}, e._rec_temp = [];
      });
    }
    function serialize(e) {
      const a = getSerializator(e);
      e.data_attributes = function() {
        var t = [], n = e._helpers.formatDate, o = a();
        for (var r in o) {
          var d = o[r];
          for (var i in d)
            i.substr(0, 1) != "_" && t.push([i, i == "start_date" || i == "end_date" ? n : null]);
          break;
        }
        return t;
      }, e.toXML = function(t) {
        var n = [], o = this.data_attributes(), r = a();
        for (var d in r) {
          var i = r[d];
          n.push("<event>");
          for (var s = 0; s < o.length; s++)
            n.push("<" + o[s][0] + "><![CDATA[" + (o[s][1] ? o[s][1](i[o[s][0]]) : i[o[s][0]]) + "]]></" + o[s][0] + ">");
          n.push("</event>");
        }
        return (t || "") + "<data>" + n.join(`
`) + "</data>";
      }, e._serialize_json_value = function(t) {
        return t === null || typeof t == "boolean" ? t = "" + t : (t || t === 0 || (t = ""), t = '"' + t.toString().replace(/\n/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'), t;
      }, e.toJSON = function() {
        return JSON.stringify(this.serialize());
      }, e.toICal = function(t) {
        var n = e.date.date_to_str("%Y%m%dT%H%i%s"), o = e.date.date_to_str("%Y%m%d"), r = [], d = a();
        for (var i in d) {
          var s = d[i];
          r.push("BEGIN:VEVENT"), s._timed && (s.start_date.getHours() || s.start_date.getMinutes()) ? r.push("DTSTART:" + n(s.start_date)) : r.push("DTSTART:" + o(s.start_date)), s._timed && (s.end_date.getHours() || s.end_date.getMinutes()) ? r.push("DTEND:" + n(s.end_date)) : r.push("DTEND:" + o(s.end_date)), r.push("SUMMARY:" + s.text), r.push("END:VEVENT");
        }
        return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//dhtmlXScheduler//NONSGML v2.2//EN
DESCRIPTION:` + (t || "") + `
` + r.join(`
`) + `
END:VCALENDAR`;
      };
    }
    function autoscroll(e) {
      let a = null, t = null;
      function n(d) {
        a && clearInterval(a);
        const i = e.matrix[e._mode];
        if (!i)
          return;
        e._schedulerOuter = e.$container.querySelector(".dhx_timeline_data_wrapper"), i.scrollable || (e._schedulerOuter = e.$container.querySelector(".dhx_cal_data"));
        const s = { pageX: d.touches ? d.touches[0].pageX : d.pageX, pageY: d.touches ? d.touches[0].pageY : d.pageY };
        a = setInterval(function() {
          (function(_) {
            if (!e.getState().drag_id)
              return clearInterval(a), void (t = null);
            const l = e.matrix[e._mode];
            if (!l)
              return;
            const h = e._schedulerOuter, u = function(p, x) {
              const w = e.matrix[e._mode], k = {}, E = {};
              let D = x;
              for (k.x = p.touches ? p.touches[0].pageX : p.pageX, k.y = p.touches ? p.touches[0].pageY : p.pageY, E.left = D.offsetLeft + w.dx, E.top = D.offsetTop; D; )
                E.left += D.offsetLeft, E.top += D.offsetTop, D = D.offsetParent;
              return { x: k.x - E.left, y: k.y - E.top };
            }(_, h), m = h.offsetWidth - l.dx, f = h.offsetHeight, y = u.x, b = u.y;
            let c = l.autoscroll || {};
            c === !0 && (c = {}), e._merge(c, { range_x: 200, range_y: 100, speed_x: 20, speed_y: 10 });
            let g = o(y, m, t ? t.x : 0, c.range_x);
            l.scrollable || (g = 0);
            let v = o(b, f, t ? t.y : 0, c.range_y);
            !v && !g || t || (t = { x: y, y: b }, g = 0, v = 0), g *= c.speed_x, v *= c.speed_y, g && v && (Math.abs(g / 5) > Math.abs(v) ? v = 0 : Math.abs(v / 5) > Math.abs(g) && (g = 0)), g || v ? (t.started = !0, function(p, x) {
              const w = e._schedulerOuter;
              x && (w.scrollTop += x), p && (w.scrollLeft += p);
            }(g, v)) : clearInterval(a);
          })(s);
        }, 10);
      }
      function o(d, i, s, _) {
        return d < _ && (!t || t.started || d < s) ? -1 : i - d < _ && (!t || t.started || d > s) ? 1 : 0;
      }
      e.attachEvent("onDestroy", function() {
        clearInterval(a);
      });
      var r = e.attachEvent("onSchedulerReady", function() {
        e.matrix && (e.event(document.body, "mousemove", n), e.detachEvent(r));
      });
    }
    dhtmlxError$1.prototype.catchError = function(e, a) {
      this.catches[e] = a;
    }, dhtmlxError$1.prototype.throwError = function(e, a, t) {
      return this.catches[e] ? this.catches[e](e, a, t) : this.catches.ALL ? this.catches.ALL(e, a, t) : (global.alert("Error type: " + arguments[0] + `
Description: ` + arguments[1]), null);
    };
    const scrollHelperFactory = function() {
      var e, a = { minMax: "[0;max]", maxMin: "[max;0]", nMaxMin: "[-max;0]" };
      function t() {
        var r = a.minMax, d = function() {
          var i = document.createElement("div");
          i.style.cssText = "direction: rtl;overflow: auto;width:100px;height: 100px;position:absolute;top: -100500px;left: -100500px;";
          var s = document.createElement("div");
          return s.style.cssText = "width: 100500px;height: 1px;", i.appendChild(s), i;
        }();
        return document.body.appendChild(d), d.scrollLeft > 0 ? r = a.minMax : (d.scrollLeft = -50, r = d.scrollLeft === -50 ? a.nMaxMin : a.maxMin), document.body.removeChild(d), r;
      }
      function n(r, d) {
        var i = o();
        return i === a.nMaxMin ? r ? -r : 0 : i === a.minMax ? d - r : r;
      }
      function o() {
        return e || (e = t()), e;
      }
      return { modes: a, getMode: o, normalizeValue: n, getScrollValue: function(r) {
        var d = getComputedStyle(r).direction;
        if (d && d !== "ltr") {
          var i = r.scrollWidth - r.offsetWidth;
          return n(r.scrollLeft, i);
        }
        return r.scrollLeft;
      }, setScrollValue: function(r, d) {
        var i = getComputedStyle(r).direction;
        if (i && i !== "ltr") {
          var s = n(d, r.scrollWidth - r.offsetWidth);
          r.scrollLeft = s;
        } else
          r.scrollLeft = d;
      } };
    };
    function smartRender(e) {
      function a(t, n) {
        for (let o = 0; o < t.length; o++)
          if (t[o].id == n)
            return !0;
        return !1;
      }
      e._timeline_smart_render = { _prepared_events_cache: null, _rendered_events_cache: [], _rendered_header_cache: [], _rendered_labels_cache: [], _rows_to_delete: [], _rows_to_add: [], _cols_to_delete: [], _cols_to_add: [], getViewPort: function(t, n, o, r) {
        var d = e.$container.querySelector(".dhx_cal_data"), i = d.getBoundingClientRect(), s = e.$container.querySelector(".dhx_timeline_scrollable_data");
        s && o === void 0 && (o = t.getScrollValue(s)), r === void 0 && (r = s ? s.scrollTop : d.scrollTop);
        var _ = {};
        for (var l in i)
          _[l] = i[l];
        return _.scrollLeft = o || 0, _.scrollTop = r || 0, n && (i.height = n), _;
      }, isInXViewPort: function(t, n) {
        var o = n.scrollLeft, r = n.width + n.scrollLeft;
        return t.left < r + 100 && t.right > o - 100;
      }, isInYViewPort: function(t, n) {
        var o = n.scrollTop, r = n.height + n.scrollTop;
        return t.top < r + 80 && t.bottom > o - 80;
      }, getVisibleHeader: function(t, n) {
        var o = "";
        for (var r in this._rendered_header_cache = [], t._h_cols) {
          var d = t._h_cols[r];
          this.isInXViewPort({ left: d.left, right: d.left + e._cols[r] }, n) && (o += d.div.outerHTML, this._rendered_header_cache.push(d.div.getAttribute("data-col-id")));
        }
        return o;
      }, updateHeader: function(t, n, o) {
        this._cols_to_delete = [], this._cols_to_add = [];
        for (var r = e.$container.querySelectorAll(".dhx_cal_header > div"), d = r[r.length - 1].querySelectorAll(".dhx_scale_bar"), i = [], s = 0; s < d.length; s++)
          i.push(d[s].getAttribute("data-col-id"));
        if (this.getVisibleHeader(t, n)) {
          for (var _ = this._rendered_header_cache.slice(), l = [], h = (s = 0, i.length); s < h; s++) {
            var u = _.indexOf(i[s]);
            u > -1 ? _.splice(u, 1) : l.push(i[s]);
          }
          l.length && (this._cols_to_delete = l.slice(), this._deleteHeaderCells(l, t, o)), _.length && (this._cols_to_add = _.slice(), this._addHeaderCells(_, t, o));
        }
      }, _deleteHeaderCells: function(t, n, o) {
        for (var r = 0; r < t.length; r++) {
          var d = o.querySelector('[data-col-id="' + t[r] + '"]');
          d && o.removeChild(d);
        }
      }, _addHeaderCells: function(t, n, o) {
        for (var r = "", d = 0; d < t.length; d++)
          r += n._h_cols[t[d]].div.outerHTML;
        const i = document.createElement("template");
        i.innerHTML = r, o.appendChild(i.content);
      }, getVisibleLabels: function(t, n) {
        if (t._label_rows.length) {
          var o = "";
          this._rendered_labels_cache = [];
          for (var r = 0; r < t._label_rows.length; r++)
            this.isInYViewPort({ top: t._label_rows[r].top, bottom: t._label_rows[r].top + t._section_height[t.y_unit[r].key] }, n) && (o += t._label_rows[r].div, this._rendered_labels_cache.push(r));
          return o;
        }
      }, updateLabels: function(t, n, o) {
        this._rows_to_delete = [], this._rows_to_add = [];
        let r = [];
        if (e.$container.querySelectorAll(".dhx_timeline_label_row").forEach((h) => {
          r.push(Number(h.getAttribute("data-row-index")));
        }), r.length || (this.getVisibleLabels(t, n), r = this._rendered_labels_cache.slice()), this.getVisibleLabels(t, n)) {
          for (var d = this._rendered_labels_cache.slice(), i = [], s = 0, _ = r.length; s < _; s++) {
            var l = d.indexOf(r[s]);
            l > -1 ? d.splice(l, 1) : i.push(r[s]);
          }
          i.length && (this._rows_to_delete = i.slice(), this._deleteLabelCells(i, t, o)), d.length && (this._rows_to_add = d.slice(), this._addLabelCells(d, t, o));
        }
      }, _deleteLabelCells: function(t, n, o) {
        for (var r = 0; r < t.length; r++) {
          var d = o.querySelector('[data-row-index="' + t[r] + '"]');
          d && o.removeChild(d);
        }
      }, _addLabelCells: function(t, n, o) {
        for (var r = "", d = 0; d < t.length; d++)
          r += n._label_rows[t[d]].div;
        const i = document.createElement("template");
        i.innerHTML = r, o.appendChild(i.content);
      }, clearPreparedEventsCache: function() {
        this.cachePreparedEvents(null);
      }, cachePreparedEvents: function(t) {
        this._prepared_events_cache = t, this._prepared_events_coordinate_cache = t;
      }, getPreparedEvents: function(t) {
        var n;
        if (this._prepared_events_cache) {
          if (n = this._prepared_events_cache, e.getState().drag_id) {
            const o = e.getState().drag_id;
            let r = !1, d = !1;
            n.forEach((i, s) => {
              if (r)
                return;
              const _ = t.y_unit[s];
              for (let l = 0; l < i.length; l++) {
                const h = i[l];
                if (h.id == o && h[t.y_property] !== _) {
                  d = !0, i.splice(l, 1), l--;
                  const u = t.order[h[t.y_property]];
                  n[u] != i && n[u] && !a(n[u], h.id) && n[u].push(h);
                }
              }
              d && (r = !0);
            });
          }
        } else
          (n = e._prepare_timeline_events(t)).$coordinates = {}, this.cachePreparedEvents(n);
        return n;
      }, updateEvents: function(t, n) {
        var o = this.getPreparedEvents(t), r = this._rendered_events_cache.slice();
        if (this._rendered_events_cache = [], !e.$container.querySelector(".dhx_cal_data .dhx_timeline_data_col"))
          return;
        const d = [];
        for (var i = 0; i < this._rendered_labels_cache.length; i++) {
          var s = this._rendered_labels_cache[i], _ = [];
          const b = t.y_unit[s].key;
          var l = r[s] ? r[s].slice() : [];
          e._timeline_calculate_event_positions.call(t, o[s]);
          for (var h = e._timeline_smart_render.getVisibleEventsForRow(t, n, o, s), u = 0, m = h.length; u < m; u++) {
            var f = l.indexOf(String(h[u].id));
            if (f > -1)
              if (e.getState().drag_id == h[u].id)
                for (let g = 0; g < l.length; g++)
                  l[g] == h[u].id && (l.splice(g, 1), g--);
              else
                l.splice(f, 1);
            else
              _.push(h[u]);
          }
          var y = t._divBySectionId[b];
          if (!y)
            continue;
          l.length && this._deleteEvents(l, t, y);
          const c = { DOMParent: y, buffer: document.createElement("template") };
          d.push(c), _.length && this._addEvents(_, t, c.buffer, s);
        }
        d.forEach(function(b) {
          b.DOMParent.appendChild(b.buffer.content);
        }), e._populate_timeline_rendered(e.$container), t._matrix = o;
      }, _deleteEvents: function(t, n, o) {
        for (var r = 0; r < t.length; r++) {
          const i = "[" + e.config.event_attribute + '="' + t[r] + '"]';
          var d = o.querySelector(i);
          if (d)
            if (d.classList.contains("dhx_in_move")) {
              const s = o.querySelectorAll(i);
              for (let _ = 0; _ < s.length; _++)
                s[_].classList.contains("dhx_in_move") || s[_].remove();
            } else
              d.remove();
        }
      }, _addEvents: function(t, n, o, r) {
        var d = e._timeline_update_events_html.call(n, t);
        o.innerHTML = d;
      }, getVisibleEventsForRow: function(t, n, o, r) {
        var d = [];
        if (t.render == "cell")
          d = o;
        else {
          var i = o[r];
          if (i)
            for (var s = 0, _ = i.length; s < _; s++) {
              var l, h, u = i[s], m = r + "_" + u.id;
              o.$coordinates && o.$coordinates[m] ? (l = o.$coordinates[m].xStart, h = o.$coordinates[m].xEnd) : (l = e._timeline_getX(u, !1, t), h = e._timeline_getX(u, !0, t), o.$coordinates && (o.$coordinates[m] = { xStart: l, xEnd: h })), e._timeline_smart_render.isInXViewPort({ left: l, right: h }, n) && (d.push(u), this._rendered_events_cache[r] || (this._rendered_events_cache[r] = []), this._rendered_events_cache[r].push(String(u.id)));
            }
        }
        return d;
      }, getVisibleRowCellsHTML: function(t, n, o, r, d) {
        for (var i, s = "", _ = this._rendered_header_cache, l = 0; l < _.length; l++) {
          var h = _[l];
          i = t._h_cols[h].left - t.dx, e._ignores[h] ? t.render == "cell" ? s += e._timeline_get_html_for_cell_ignores(o) : s += e._timeline_get_html_for_bar_ignores() : t.render == "cell" ? s += e._timeline_get_html_for_cell(h, d, t, r[d][h], o, i) : s += e._timeline_get_html_for_bar(h, d, t, r[d], i);
        }
        return s;
      }, getVisibleTimelineRowsHTML: function(t, n, o, r) {
        var d = "", i = e._timeline_get_cur_row_stats(t, r);
        i = e._timeline_get_fit_events_stats(t, r, i);
        var s = t._label_rows[r], _ = e.templates[t.name + "_row_class"], l = { view: t, section: s.section, template: _ };
        return t.render == "cell" ? (d += e._timeline_get_html_for_cell_data_row(r, i, s.top, s.section.key, l), d += this.getVisibleRowCellsHTML(t, n, i, o, r), d += "</div>") : (d += e._timeline_get_html_for_bar_matrix_line(r, i, s.top, s.section.key, l), d += e._timeline_get_html_for_bar_data_row(i, l), d += this.getVisibleRowCellsHTML(t, n, i, o, r), d += "</div></div>"), d;
      }, updateGridRows: function(t, n) {
        this._rows_to_delete.length && this._deleteGridRows(this._rows_to_delete, t), this._rows_to_add.length && this._addGridRows(this._rows_to_add, t, n);
      }, _deleteGridRows: function(t, n) {
        if (e.$container.querySelector(".dhx_cal_data .dhx_timeline_data_col")) {
          for (var o = 0; o < t.length; o++) {
            const r = n.y_unit[t[o]] ? n.y_unit[t[o]].key : null;
            n._divBySectionId[r] && (n._divBySectionId[r].remove(), delete n._divBySectionId[r]);
          }
          this._rows_to_delete = [];
        }
      }, _addGridRows: function(t, n, o) {
        if (!(_ = e.$container.querySelector(".dhx_cal_data .dhx_timeline_data_col")))
          return;
        for (var r = this.getPreparedEvents(n), d = "", i = 0; i < t.length; i++)
          d += this.getVisibleTimelineRowsHTML(n, o, r, t[i]);
        const s = document.createElement("template");
        s.innerHTML = d, _.appendChild(s.content);
        var _ = e.$container.querySelector(".dhx_cal_data .dhx_timeline_data_col");
        n._divBySectionId = {};
        for (let h = 0, u = _.children.length; h < u; h++) {
          var l = _.children[h];
          l.hasAttribute("data-section-id") && (n._divBySectionId[l.getAttribute("data-section-id")] = l);
        }
        for (i = 0; i < t.length; i++) {
          const h = n.y_unit[t[i]] ? n.y_unit[t[i]].key : null;
          e._timeline_finalize_section_add(n, n.y_unit[t[i]].key, n._divBySectionId[h]);
        }
        e._mark_now && e._mark_now(), this._rows_to_add = [];
      }, updateGridCols: function(t, n) {
        for (var o = this._rendered_header_cache, r = {}, d = 0; d < o.length; d++)
          r[o[d]] = !0;
        e.$container.querySelectorAll(".dhx_timeline_data_row").forEach((function(i) {
          const s = i.querySelectorAll("[data-col-id]"), _ = Array.prototype.reduce.call(s, function(m, f) {
            return m[f.dataset.colId] = f, m;
          }, {});
          var l = [], h = [];
          for (var u in _)
            r[u] || l.push(_[u]);
          for (var u in r)
            _[u] || h.push(u);
          l.forEach(function(m) {
            m.remove();
          }), h.length && this._addGridCols(i, h, t, n);
        }).bind(this));
      }, _addGridCols: function(t, n, o, r) {
        if (e.$container.querySelector(".dhx_cal_data .dhx_timeline_data_col"))
          for (var d = this.getPreparedEvents(o), i = 0; i < this._rendered_labels_cache.length; i++) {
            var s = this._rendered_labels_cache[i], _ = "", l = e._timeline_get_cur_row_stats(o, s);
            l = e._timeline_get_fit_events_stats(o, s, l);
            var h = t;
            if (h) {
              for (var u = 0; u < n.length; u++)
                if (!h.querySelector('[data-col-id="' + n[u] + '"]')) {
                  var m = this.getVisibleGridCell(o, r, l, d, s, n[u]);
                  m && (_ += m);
                }
              const f = document.createElement("template");
              f.innerHTML = _, h.appendChild(f.content);
            }
          }
      }, getVisibleGridCell: function(t, n, o, r, d, i) {
        if (t._h_cols[i]) {
          var s = "", _ = t._h_cols[i].left - t.dx;
          return t.render == "cell" ? e._ignores[i] || (s += e._timeline_get_html_for_cell(i, d, t, r[d][i], o, _)) : e._ignores[i] || (s += e._timeline_get_html_for_bar(i, d, t, r[d], _)), s;
        }
      } }, e.attachEvent("onClearAll", function() {
        e._timeline_smart_render._prepared_events_cache = null, e._timeline_smart_render._rendered_events_cache = [];
      });
    }
    function timeline(e) {
      function a() {
        var t = document.createElement("p");
        t.style.width = "100%", t.style.height = "200px";
        var n = document.createElement("div");
        n.style.position = "absolute", n.style.top = "0px", n.style.left = "0px", n.style.visibility = "hidden", n.style.width = "200px", n.style.height = "150px", n.style.overflow = "hidden", n.appendChild(t), document.body.appendChild(n);
        var o = t.offsetWidth;
        n.style.overflow = "scroll";
        var r = t.offsetWidth;
        return o == r && (r = n.clientWidth), document.body.removeChild(n), o - r;
      }
      e.ext.timeline = { renderCells: function(t, n, o) {
        if (!t || !t.length)
          return;
        const r = [];
        for (let d = 0; d < t.length; d++) {
          const i = t[d];
          let s = "";
          i.$width && (s = "width:" + i.$width + "px;");
          let _ = o;
          i.css && (_ += " " + i.css), d === 0 && (_ += " " + o + "_first"), d === t.length - 1 && (_ += " " + o + "_last");
          const l = n(i) || "";
          r.push(`<div class='${_}' style='${s}'><div class='dhx_timeline_label_content_wrapper'>${l}</div></div>`);
        }
        return r.join("");
      }, renderHeading: function() {
        return this.renderCells(this.columns, function(t) {
          return t.label;
        }, "dhx_timeline_label_column dhx_timeline_label_column_header");
      }, renderColumns: function(t) {
        return this.renderCells(this.columns, function(n) {
          return n.template && n.template.call(self, t) || "";
        }, "dhx_timeline_label_column");
      }, scrollTo: function(t) {
        if (t) {
          var n;
          n = t.date ? t.date : t.left ? t.left : t;
          var o, r = -1;
          if (t.section ? r = this.getSectionTop(t.section) : t.top && (r = t.top), o = typeof n == "number" ? n : this.posFromDate(n), e.config.rtl) {
            var d = +e.$container.querySelector(".dhx_timeline_label_wrapper").style.height.replace("px", ""), i = this._section_height[this.y_unit.length] + this._label_rows[this._label_rows.length - 1].top;
            this.scrollHelper.getMode() == this.scrollHelper.modes.minMax && (i > d || this.render == "tree") && (o -= a());
          }
          var s = e.$container.querySelector(".dhx_timeline_data_wrapper");
          this.scrollable || (s = e.$container.querySelector(".dhx_cal_data")), this.scrollable && this.scrollHelper.setScrollValue(s, o), r > 0 && (s.scrollTop = r);
        }
      }, getScrollPosition: function() {
        return { left: this._x_scroll || 0, top: this._y_scroll || 0 };
      }, posFromDate: function(t) {
        return e._timeline_getX({ start_date: t }, !1, this) - 1;
      }, dateFromPos: function(t) {
        return e._timeline_drag_date(this, t);
      }, sectionFromPos: function(t) {
        var n = { y: t };
        return e._resolve_timeline_section(this, n), n.section;
      }, resolvePosition: function(t) {
        var n = { date: null, section: null };
        return t.left && (n.date = this.dateFromPos(t.left)), t.top && (n.section = this.sectionFromPos(t.top)), n;
      }, getSectionHeight: function(t) {
        return this._section_height[t];
      }, getSectionTop: function(t) {
        return this._rowStats[t].top;
      }, getEventTop: function(t) {
        var n = this.getEventHeight(t), o = t._sorder || 0, r = 1 + o * (n - 3) + (o ? 2 * o : 0);
        return e.config.cascade_event_display && (r = 1 + o * e.config.cascade_event_margin + (o ? 2 * o : 0)), r;
      }, getEventHeight: function(t) {
        var n = this, o = t[n.y_property], r = n.event_dy;
        return n.event_dy == "full" && (r = n.section_autoheight ? n.getSectionHeight(o) - 6 : n.dy - 3), n.resize_events && (r = Math.max(Math.floor(r / (t._count || 1)), n.event_min_dy)), r;
      } }, e._temp_matrix_scope = function() {
        function t(c, g) {
          if (g = g || [], c.children)
            for (var v = 0; v < c.children.length; v++)
              g.push(c.children[v].key), t(c.children[v], g);
          return g;
        }
        function n(c, g) {
          var v = g.order[c];
          return v === void 0 && (v = "$_" + c), v;
        }
        function o(c, g) {
          if (g[c.key] = c, c.children)
            for (var v = 0; v < c.children.length; v++)
              o(c.children[v], g);
        }
        function r(c, g) {
          for (var v, p = [], x = 0; x < g.y_unit.length; x++)
            p[x] = [];
          p[v] || (p[v] = []);
          var w = function(L) {
            for (var $ = {}, P = L.y_unit_original || L.y_unit, j = 0; j < P.length; j++)
              o(P[j], $);
            return $;
          }(g), k = g.render == "tree";
          function E(L, $, P, j) {
            L[$] || (L[$] = []);
            for (var I = P; I <= j; I++)
              L[$][I] || (L[$][I] = []), L[$][I].push(S);
          }
          k && (p.$tree = {});
          var D = g.y_property;
          for (x = 0; x < c.length; x++) {
            var S = c[x], N = S[D];
            v = n(N, g);
            var A = e._get_date_index(g, S.start_date), M = e._get_date_index(g, S.end_date);
            S.end_date.valueOf() == g._trace_x[M].valueOf() && (M -= 1), p[v] || (p[v] = []), E(p, v, A, M);
            var C = w[N];
            if (k && C && C.$parent)
              for (var T = {}; C.$parent; ) {
                if (T[C.key])
                  throw new Error("Invalid sections tree. Section `{key:'" + C.key + "', label:'" + C.label + "'}` has the same key as one of its parents. Make sure all sections have unique keys");
                T[C.key] = !0;
                var O = w[C.$parent];
                E(p.$tree, O.key, A, M), C = O;
              }
          }
          return p;
        }
        e.matrix = {}, e._merge = function(c, g) {
          for (var v in g)
            c[v] === void 0 && (c[v] = g[v]);
        }, e.createTimelineView = function(c) {
          e._merge(c, { scrollHelper: scrollHelperFactory(), column_width: 100, autoscroll: { range_x: 200, range_y: 100, speed_x: 20, speed_y: 10 }, _is_new_view: !0, _section_autowidth: !0, _x_scroll: 0, _y_scroll: 0, _h_cols: {}, _label_rows: [], section_autoheight: !0, name: "matrix", x: "time", y: "time", x_step: 1, x_unit: "hour", y_unit: "day", y_step: 1, x_start: 0, x_size: 24, y_start: 0, y_size: 7, render: "cell", dx: 200, dy: 50, event_dy: e.xy.bar_height, event_min_dy: e.xy.bar_height, resize_events: !0, fit_events: !0, fit_events_offset: 0, show_unassigned: !1, second_scale: !1, round_position: !1, _logic: function(v, p, x) {
            var w = {};
            return e.checkEvent("onBeforeSectionRender") && (w = e.callEvent("onBeforeSectionRender", [v, p, x])), w;
          } }), c._original_x_start = c.x_start, c.x_unit != "day" && (c.first_hour = c.last_hour = 0), c._start_correction = c.first_hour ? 60 * c.first_hour * 60 * 1e3 : 0, c._end_correction = c.last_hour ? 60 * (24 - c.last_hour) * 60 * 1e3 : 0, e.checkEvent("onTimelineCreated") && e.callEvent("onTimelineCreated", [c]), makeEventable(c), e.attachEvent("onDestroy", function() {
            c.detachAllEvents();
          });
          var g = e.render_data;
          e.render_data = function(v, p) {
            if (this._mode != c.name)
              return g.apply(this, arguments);
            if (p && !c.show_unassigned && c.render != "cell")
              for (var x = 0; x < v.length; x++)
                this.clear_event(v[x]), this.render_timeline_event.call(this.matrix[this._mode], v[x], !0);
            else
              e._renderMatrix.call(c, !0, !0);
          }, e.matrix[c.name] = c, e.templates[c.name + "_cell_value"] = function(v) {
            return v ? v.length : "";
          }, e.templates[c.name + "_cell_class"] = function(v) {
            return "";
          }, e.templates[c.name + "_scalex_class"] = function(v) {
            return "";
          }, e.templates[c.name + "_second_scalex_class"] = function(v) {
            return "";
          }, e.templates[c.name + "_row_class"] = function(v, p) {
            return p.folder_events_available && v.children ? "folder" : "";
          }, e.templates[c.name + "_scaley_class"] = function(v, p, x) {
            return "";
          }, c.attachEvent("onBeforeRender", function() {
            return c.columns && c.columns.length && function(v, p) {
              var x = p.dx, w = 0, k = [];
              v.forEach(function(N) {
                N.width ? (w += N.width, N.$width = N.width) : k.push(N);
              });
              var E = !1, D = x - w;
              (D < 0 || k.length === 0) && (E = !0);
              var S = k.length;
              k.forEach(function(N) {
                N.$width = Math.max(Math.floor(D / S), 20), D -= N.$width, w += N.$width, S--;
              }), E && (p.dx = w);
            }(c.columns, c), !0;
          }), c.renderColumns = c.renderColumns || e.ext.timeline.renderColumns.bind(c), c.renderHeading = c.renderHeading || e.ext.timeline.renderHeading.bind(c), c.renderCells = c.renderCells || e.ext.timeline.renderCells.bind(c), e.templates[c.name + "_scale_label"] = function(v, p, x) {
            return c.columns && c.columns.length ? c.renderColumns(x) : p;
          }, e.templates[c.name + "_scale_header"] = function(v) {
            return c.columns ? v.renderHeading(v) : e.locale.labels[c.name + "_scale_header"] || "";
          }, e.templates[c.name + "_tooltip"] = function(v, p, x) {
            return x.text;
          }, e.templates[c.name + "_date"] = function(v, p) {
            return v.getDay() == p.getDay() && p - v < 864e5 || +v == +e.date.date_part(new Date(p)) || +e.date.add(v, 1, "day") == +p && p.getHours() === 0 && p.getMinutes() === 0 ? e.templates.day_date(v) : v.getDay() != p.getDay() && p - v < 864e5 ? e.templates.day_date(v) + " &ndash; " + e.templates.day_date(p) : e.templates.week_date(v, p);
          }, e.templates[c.name + "_scale_date"] = e.date.date_to_str(c.x_date || e.config.hour_date), e.templates[c.name + "_second_scale_date"] = e.date.date_to_str(c.second_scale && c.second_scale.x_date ? c.second_scale.x_date : e.config.hour_date), e.date["add_" + c.name + "_private"] = function(v, p) {
            var x = p, w = c.x_unit;
            if (c.x_unit == "minute" || c.x_unit == "hour") {
              var k = x;
              c.x_unit == "hour" && (k *= 60), k % 1440 || (x = k / 1440, w = "day");
            }
            return e.date.add(v, x, w);
          }, e.date["add_" + c.name] = function(v, p, x) {
            var w = e.date["add_" + c.name + "_private"](v, (c.x_length || c.x_size) * c.x_step * p);
            if (c.x_unit == "minute" || c.x_unit == "hour") {
              var k = c.x_length || c.x_size, E = c.x_unit == "hour" ? 60 * c.x_step : c.x_step;
              if (E * k % 1440)
                if (+e.date.date_part(new Date(v)) == +e.date.date_part(new Date(w)))
                  c.x_start += p * k;
                else {
                  var D = 1440 / (k * E) - 1, S = Math.round(D * k);
                  c.x_start = p > 0 ? c.x_start - S : S + c.x_start;
                }
            }
            return w;
          }, e.date[c.name + "_start"] = function(v) {
            var p = (e.date[c.x_unit + "_start"] || e.date.day_start).call(e.date, v), x = p.getTimezoneOffset(), w = (p = e.date.add(p, c.x_step * c.x_start, c.x_unit)).getTimezoneOffset();
            return x != w && p.setTime(p.getTime() + 6e4 * (w - x)), p;
          }, c._smartRenderingEnabled = function() {
            var v = null;
            (this.scrollable || this.smart_rendering) && (v = e._timeline_smart_render.getViewPort(this.scrollHelper, this._sch_height));
            var p = !!v;
            return !!(this.scrollable ? this.smart_rendering !== !1 && p : this.smart_rendering && p);
          }, c.scrollTo = c.scrollTo || e.ext.timeline.scrollTo.bind(c), c.getScrollPosition = c.getScrollPosition || e.ext.timeline.getScrollPosition.bind(c), c.posFromDate = c.posFromDate || e.ext.timeline.posFromDate.bind(c), c.dateFromPos = c.dateFromPos || e.ext.timeline.dateFromPos.bind(c), c.sectionFromPos = c.sectionFromPos || e.ext.timeline.sectionFromPos.bind(c), c.resolvePosition = c.resolvePosition || e.ext.timeline.resolvePosition.bind(c), c.getSectionHeight = c.getSectionHeight || e.ext.timeline.getSectionHeight.bind(c), c.getSectionTop = c.getSectionTop || e.ext.timeline.getSectionTop.bind(c), c.getEventTop = c.getEventTop || e.ext.timeline.getEventTop.bind(c), c.getEventHeight = c.getEventHeight || e.ext.timeline.getEventHeight.bind(c), c.selectEvents = e.bind(function(v) {
            var p = v.section, x = v.date, w = v.selectNested;
            return x ? function(k, E, D, S) {
              var N = e._timeline_smart_render.getPreparedEvents(S), A = [], M = [], C = S.order[k], T = S.y_unit[C];
              if (!T)
                return [];
              var O = e._get_date_index(S, E);
              return N.$matrix ? (A = N.$matrix[C][O] || [], D && N.$matrix.$tree && N.$matrix.$tree[T.key] && (M = N.$matrix.$tree[T.key][O] || []), A.concat(M)) : N[C] || [];
            }(p, x, w, this) : p ? function(k, E, D) {
              var S = e._timeline_smart_render.getPreparedEvents(D), N = D.order[k], A = D.y_unit[N];
              if (!A)
                return [];
              var M = [k];
              E && t(A, M);
              for (var C = [], T = 0; T < M.length; T++)
                if ((N = D.order[M[T]]) !== void 0 && S[N])
                  C = C.concat(S[N]);
                else if (S.undefined)
                  for (var O = 0; O < S.undefined.length; O++) {
                    var L = S.undefined[O];
                    L[D.y_property] == M[T] && C.push(L);
                  }
              return C;
            }(p, w, this) : void 0;
          }, c), c.setRange = e.bind(function(v, p) {
            var x = e.date[this.name + "_start"](new Date(v)), w = function(k, E, D) {
              for (var S = 0, N = e.date[D.name + "_start"](new Date(k)), A = D.x_step, M = D.x_unit; N < E; )
                S++, N = e.date.add(N, A, M);
              return S;
            }(v, p, this);
            this.x_size = w, e.setCurrentView(x, this.name);
          }, c), e.callEvent("onOptionsLoad", [c]), e[c.name + "_view"] = function(v) {
            v ? e._set_timeline_dates(c) : e._renderMatrix.apply(c, arguments);
          }, e["mouse_" + c.name] = function(v) {
            var p = this._drag_event;
            if (this._drag_id && (p = this.getEvent(this._drag_id)), c.scrollable && !v.converted) {
              if (v.converted = 1, v.x += -c.dx + c._x_scroll, e.config.rtl) {
                var x = +e.$container.querySelector(".dhx_timeline_label_wrapper").style.height.replace("px", ""), w = c._section_height[c.y_unit.length] + c._label_rows[c._label_rows.length - 1].top;
                v.x += e.xy.scale_width, c.scrollHelper.getMode() == c.scrollHelper.modes.minMax && (w > x || c.render == "tree") && (v.x += a());
              }
              v.y += c._y_scroll;
            } else
              e.config.rtl ? v.x -= c.dx - e.xy.scale_width : v.x -= c.dx;
            var k = e._timeline_drag_date(c, v.x);
            if (v.x = 0, v.force_redraw = !0, v.custom = !0, this._drag_mode == "move" && this._drag_id && this._drag_event) {
              p = this.getEvent(this._drag_id);
              var E = this._drag_event;
              if (v._ignores = this._ignores_detected || c._start_correction || c._end_correction, E._move_delta === void 0 && (E._move_delta = (p.start_date - k) / 6e4, this.config.preserve_length && v._ignores && (E._move_delta = this._get_real_event_length(p.start_date, k, c), E._event_length = this._get_real_event_length(p.start_date, p.end_date, c))), this.config.preserve_length && v._ignores) {
                var D = this._get_fictional_event_length(k, E._move_delta, c, !0);
                k = new Date(k - D);
              } else
                k = e.date.add(k, E._move_delta, "minute");
            }
            if (this._drag_mode == "resize" && p && (this.config.timeline_swap_resize && this._drag_id && (this._drag_from_start && +k > +p.end_date ? this._drag_from_start = !1 : !this._drag_from_start && +k < +p.start_date && (this._drag_from_start = !0)), v.resize_from_start = this._drag_from_start, !this.config.timeline_swap_resize && this._drag_id && this._drag_from_start && +k >= +e.date.add(p.end_date, -e.config.time_step, "minute") && (k = e.date.add(p.end_date, -e.config.time_step, "minute"))), c.round_position)
              switch (this._drag_mode) {
                case "move":
                  this.config.preserve_length || (k = e._timeline_get_rounded_date.call(c, k, !1), c.x_unit == "day" && (v.custom = !1));
                  break;
                case "resize":
                  this._drag_event && (this._drag_event._resize_from_start !== null && this._drag_event._resize_from_start !== void 0 || (this._drag_event._resize_from_start = v.resize_from_start), v.resize_from_start = this._drag_event._resize_from_start, k = e._timeline_get_rounded_date.call(c, k, !this._drag_event._resize_from_start));
              }
            this._resolve_timeline_section(c, v), v.section && this._update_timeline_section({ pos: v, event: this.getEvent(this._drag_id), view: c }), v.y = Math.round((this._correct_shift(k, 1) - this._min_date) / (6e4 * this.config.time_step)), v.shift = this.config.time_step, c.round_position && this._drag_mode == "new-size" && k <= this._drag_start && (v.shift = e.date.add(this._drag_start, c.x_step, c.x_unit) - this._drag_start);
            var S = this._is_pos_changed(this._drag_pos, v);
            return this._drag_pos && S && (this._drag_event._dhx_changed = !0), S || this._drag_pos.has_moved || (v.force_redraw = !1), v;
          };
        }, e._prepare_timeline_events = function(c) {
          var g = [];
          if (c.render == "cell")
            g = e._timeline_trace_events.call(c);
          else {
            for (var v = e.get_visible_events(), p = c.order, x = 0; x < v.length; x++) {
              var w = v[x], k = w[c.y_property], E = c.order[k];
              if (c.show_unassigned && !k) {
                for (var D in p)
                  if (p.hasOwnProperty(D)) {
                    g[E = p[D]] || (g[E] = []);
                    var S = e._lame_copy({}, w);
                    S[c.y_property] = D, g[E].push(S);
                    break;
                  }
              } else
                g[E] || (g[E] = []), g[E].push(w);
            }
            g.$matrix = e._timeline_trace_events.call(c);
          }
          return g;
        }, e._populate_timeline_rendered = function(c) {
          e._rendered = [];
          const g = c.querySelector(".dhx_timeline_data_col"), v = Array.prototype.slice.call(g.children);
          e._timeline_smart_render && e._timeline_smart_render._rendered_events_cache && (e._timeline_smart_render._rendered_events_cache = []), v.forEach(function(p) {
            const x = Number(p.getAttribute("data-section-index"));
            Array.prototype.slice.call(p.children).forEach(function(w) {
              const k = w.getAttribute(e.config.event_attribute);
              if (k && (e._rendered.push(w), e._timeline_smart_render && e._timeline_smart_render._rendered_events_cache)) {
                const E = e._timeline_smart_render._rendered_events_cache;
                E[x] || (E[x] = []), E[x].push(k);
              }
            });
          });
        }, e.render_timeline_event = function(c, g) {
          var v = c[this.y_property];
          if (!v)
            return "";
          var p = c._sorder, x = e._timeline_getX(c, !1, this), w = e._timeline_getX(c, !0, this), k = e._get_timeline_event_height ? e._get_timeline_event_height(c, this) : this.getEventHeight(c), E = k - 2;
          c._inner || this.event_dy != "full" || (E = (E + 1) * (c._count - p) - 2);
          var D = e._get_timeline_event_y ? e._get_timeline_event_y(c._sorder, k) : this.getEventTop(c), S = k + D + 2;
          (!this._events_height[v] || this._events_height[v] < S) && (this._events_height[v] = S);
          var N = e.templates.event_class(c.start_date, c.end_date, c);
          N = "dhx_cal_event_line " + (N || ""), e.getState().select_id == c.id && (N += " dhx_cal_event_selected"), c._no_drag_move && (N += " no_drag_move");
          var A = c.color ? "--dhx-scheduler-event-background:" + c.color + ";" : "", M = c.textColor ? "--dhx-scheduler-event-color:" + c.textColor + ";" : "", C = e.templates.event_bar_text(c.start_date, c.end_date, c);
          const T = Math.max(0, w - x);
          T < 70 && (N += " dhx_cal_event--small"), T < 40 && (N += " dhx_cal_event--xsmall");
          var O = "<div " + e._waiAria.eventBarAttrString(c) + " event_id='" + c.id + "' " + e.config.event_attribute + "='" + c.id + "' class='" + N + "' style='" + A + M + "position:absolute; top:" + D + "px; height: " + E + "px; " + (e.config.rtl ? "right:" : "left:") + x + "px; width:" + T + "px;" + (c._text_style || "") + "'>";
          if (e.config.drag_resize && !e.config.readonly) {
            var L = "dhx_event_resize", $ = E + 1, P = "<div class='" + L + " " + L + "_start' style='height: " + $ + "px;'></div>", j = "<div class='" + L + " " + L + "_end' style='height: " + $ + "px;'></div>";
            O += (c._no_resize_start ? "" : P) + (c._no_resize_end ? "" : j);
          }
          if (O += C + "</div>", !g)
            return O;
          var I = document.createElement("div");
          I.innerHTML = O;
          var Y = this._scales[v];
          Y && (e._rendered.push(I.firstChild), Y.appendChild(I.firstChild));
        };
        var d = function(c) {
          return String(c).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        };
        function i(c) {
          return c.height && !isNaN(Number(c.height));
        }
        function s(c) {
          return e._helpers.formatDate(c);
        }
        function _(c, g) {
          var v = c.querySelector(".dhx_timeline_data_wrapper");
          return g.scrollable || (v = e.$container.querySelector(".dhx_cal_data")), v;
        }
        function l() {
          return e.$container.querySelector(".dhx_cal_data .dhx_timeline_label_col");
        }
        e._timeline_trace_events = function() {
          return r(e.get_visible_events(), this);
        }, e._timeline_getX = function(c, g, v) {
          var p = 0, x = v._step, w = v.round_position, k = 0, E = g ? c.end_date : c.start_date;
          E.valueOf() > e._max_date.valueOf() && (E = e._max_date);
          var D = E - e._min_date_timeline;
          if (D > 0) {
            var S = e._get_date_index(v, E);
            e._ignores[S] && (w = !0);
            for (var N = 0; N < S; N++)
              p += e._cols[N];
            var A = e._timeline_get_rounded_date.apply(v, [E, !1]);
            w ? +E > +A && g && (k = e._cols[S]) : (D = E - A, v.first_hour || v.last_hour ? ((D -= v._start_correction) < 0 && (D = 0), (k = Math.round(D / x)) > e._cols[S] && (k = e._cols[S])) : k = Math.round(D / x));
          }
          return p += g && (D === 0 || w) ? k - 1 : k;
        }, e._timeline_get_rounded_date = function(c, g) {
          var v = e._get_date_index(this, c), p = this._trace_x[v];
          return g && +c != +this._trace_x[v] && (p = this._trace_x[v + 1] ? this._trace_x[v + 1] : e.date.add(this._trace_x[v], this.x_step, this.x_unit)), new Date(p);
        }, e._timeline_skip_ignored = function(c) {
          if (e._ignores_detected)
            for (var g, v, p, x, w = 0; w < c.length; w++) {
              for (x = c[w], p = !1, g = e._get_date_index(this, x.start_date), v = e._get_date_index(this, x.end_date); g < v; ) {
                if (!e._ignores[g]) {
                  p = !0;
                  break;
                }
                g++;
              }
              p || g != v || e._ignores[v] || +x.end_date > +this._trace_x[v] && (p = !0), p || (c.splice(w, 1), w--);
            }
        }, e._timeline_calculate_event_positions = function(c) {
          if (c && this.render != "cell") {
            e._timeline_skip_ignored.call(this, c), c.sort(this.sort || function($, P) {
              return $.start_date.valueOf() == P.start_date.valueOf() ? $.id > P.id ? 1 : -1 : $.start_date > P.start_date ? 1 : -1;
            });
            for (var g = [], v = c.length, p = -1, x = null, w = 0; w < v; w++) {
              var k = c[w];
              k._inner = !1;
              for (var E = this.round_position ? e._timeline_get_rounded_date.apply(this, [k.start_date, !1]) : k.start_date; g.length && g[g.length - 1].end_date.valueOf() <= E.valueOf(); )
                g.splice(g.length - 1, 1);
              for (var D = !1, S = 0; S < g.length; S++) {
                var N = g[S];
                if (N.end_date.valueOf() <= E.valueOf()) {
                  D = !0, k._sorder = N._sorder, g.splice(S, 1), k._inner = !0;
                  break;
                }
              }
              if (g.length && (g[g.length - 1]._inner = !0), !D)
                if (g.length)
                  if (g.length <= g[g.length - 1]._sorder) {
                    if (g[g.length - 1]._sorder)
                      for (var A = 0; A < g.length; A++) {
                        for (var M = !1, C = 0; C < g.length; C++)
                          if (g[C]._sorder == A) {
                            M = !0;
                            break;
                          }
                        if (!M) {
                          k._sorder = A;
                          break;
                        }
                      }
                    else
                      k._sorder = 0;
                    k._inner = !0;
                  } else {
                    for (var T = g[0]._sorder, O = 1; O < g.length; O++)
                      g[O]._sorder > T && (T = g[O]._sorder);
                    k._sorder = T + 1, p < k._sorder && (p = k._sorder, x = k), k._inner = !1;
                  }
                else
                  k._sorder = 0;
              g.push(k), g.length > (g.max_count || 0) ? (g.max_count = g.length, k._count = g.length) : k._count = k._count ? k._count : 1;
            }
            for (var L = 0; L < c.length; L++)
              c[L]._count = g.max_count, e._register_copy && e._register_copy(c[L]);
            (x || c[0]) && e.render_timeline_event.call(this, x || c[0], !1);
          }
        }, e._timeline_get_events_html = function(c) {
          var g = "";
          if (c && this.render != "cell")
            for (var v = 0; v < c.length; v++)
              g += e.render_timeline_event.call(this, c[v], !1);
          return g;
        }, e._timeline_update_events_html = function(c) {
          var g = "";
          if (c && this.render != "cell") {
            var v = e.getView(), p = {};
            c.forEach(function(w) {
              var k, E;
              p[k = w.id, E = w[v.y_property], k + "_" + E] = !0;
            });
            for (var x = 0; x < c.length; x++)
              g += e.render_timeline_event.call(this, c[x], !1);
          }
          return g;
        }, e._timeline_get_block_stats = function(c, g) {
          var v = {};
          return g._sch_height = c.offsetHeight, v.style_data_wrapper = (e.config.rtl ? "padding-right:" : "padding-left:") + g.dx + "px;", v.style_label_wrapper = "width: " + g.dx + "px;", g.scrollable ? (v.style_data_wrapper += "height:" + (g._sch_height - 1) + "px;", g.html_scroll_width === void 0 && (g.html_scroll_width = a()), g._section_autowidth ? g.custom_scroll_width = 0 : g.custom_scroll_width = g.html_scroll_width, v.style_label_wrapper += "height:" + (g._sch_height - 1 - g.custom_scroll_width) + "px;") : (v.style_data_wrapper += "height:" + (g._sch_height - 1) + "px;", v.style_label_wrapper += "height:" + (g._sch_height - 1) + "px;overflow:visible;"), v;
        }, e._timeline_get_cur_row_stats = function(c, g) {
          var v = c.y_unit[g], p = c._logic(c.render, v, c);
          if (e._merge(p, { height: c.dy }), c.section_autoheight && !i(v)) {
            var x = function(E, D) {
              var S = 0, N = E.y_unit.length, A = 0;
              return E.y_unit.forEach(function(M) {
                i(M) && (S += Number(M.height), A += Number(M.height), N--);
              }), { totalHeight: S += N * D, rowsWithDefaultHeight: N, totalCustomHeight: A };
            }(c, p.height), w = c.scrollable ? c._sch_height - e.xy.scroll_width : c._sch_height;
            x.totalHeight < w && x.rowsWithDefaultHeight > 0 && (p.height = Math.max(p.height, Math.floor((w - 1 - x.totalCustomHeight) / x.rowsWithDefaultHeight)));
          }
          if (i(v) && (p.height = Number(v.height)), c._section_height[v.key] = p.height, !p.td_className) {
            p.td_className = "dhx_matrix_scell";
            var k = e.templates[c.name + "_scaley_class"](c.y_unit[g].key, c.y_unit[g].label, c.y_unit[g]);
            k && (p.td_className += " " + k), c.columns && (p.td_className += " dhx_matrix_scell_columns");
          }
          return p.td_content || (p.td_content = e.templates[c.name + "_scale_label"](c.y_unit[g].key, c.y_unit[g].label, c.y_unit[g])), e._merge(p, { tr_className: "", style_height: "height:" + p.height + "px;", style_width: "width:" + c.dx + "px;", summ_width: "width:" + c._summ + "px;", table_className: "" }), p;
        }, e._timeline_get_fit_events_stats = function(c, g, v) {
          if (c.fit_events) {
            var p = c._events_height[c.y_unit[g].key] || 0;
            c.fit_events_offset && (p += c.fit_events_offset), v.height = p > v.height ? p : v.height, v.style_height = "height:" + v.height + "px;", v.style_line_height = "line-height:" + (v.height - 1) + "px;", c._section_height[c.y_unit[g].key] = v.height;
          }
          return v.style_height = "height:" + v.height + "px;", v.style_line_height = "line-height:" + (v.height - 1) + "px;", c._section_height[c.y_unit[g].key] = v.height, v;
        }, e._timeline_set_scroll_pos = function(c, g) {
          var v = c.querySelector(".dhx_timeline_data_wrapper");
          v.scrollTop = g._y_scroll || 0, g.scrollHelper.setScrollValue(v, g._x_scroll || 0), g.scrollHelper.getMode() != g.scrollHelper.modes.maxMin && v.scrollLeft == g._summ - v.offsetWidth + g.dx && (v.scrollLeft += a());
        }, e._timeline_save_scroll_pos = function(c, g, v, p) {
          c._y_scroll = g || 0, c._x_scroll = v || 0;
        }, e._timeline_get_html_for_cell_data_row = function(c, g, v, p, x) {
          var w = "";
          return x.template && (w += " " + (x.template(x.section, x.view) || "")), "<div class='dhx_timeline_data_row" + w + "' data-section-id='" + d(p) + "' data-section-index='" + c + "' style='" + g.summ_width + g.style_height + " position:absolute; top:" + v + "px;'>";
        }, e._timeline_get_html_for_cell_ignores = function(c) {
          return '<div class="dhx_matrix_cell dhx_timeline_data_cell" style="' + c.style_height + c.style_line_height + ';display:none"></div>';
        }, e._timeline_get_html_for_cell = function(c, g, v, p, x, w) {
          var k = v._trace_x[c], E = v.y_unit[g], D = e._cols[c], S = s(k), N = e.templates[v.name + "_cell_value"](p, k, E);
          return "<div data-col-id='" + c + "' data-col-date='" + S + "' class='dhx_matrix_cell dhx_timeline_data_cell " + e.templates[v.name + "_cell_class"](p, k, E) + "' style='width:" + D + "px;" + x.style_height + x.style_line_height + (e.config.rtl ? " right:" : "  left:") + w + "px;'><div style='width:auto'>" + N + "</div></div>";
        }, e._timeline_get_html_for_bar_matrix_line = function(c, g, v, p) {
          return "<div style='" + g.summ_width + " " + g.style_height + " position:absolute; top:" + v + "px;' data-section-id='" + d(p) + "' data-section-index='" + c + "' class='dhx_matrix_line'>";
        }, e._timeline_get_html_for_bar_data_row = function(c, g) {
          var v = c.table_className;
          return g.template && (v += " " + (g.template(g.section, g.view) || "")), "<div class='dhx_timeline_data_row " + v + "' style='" + c.summ_width + " " + c.style_height + "' >";
        }, e._timeline_get_html_for_bar_ignores = function() {
          return "";
        }, e._timeline_get_html_for_bar = function(c, g, v, p, x, w) {
          var k = s(v._trace_x[c]), E = v.y_unit[g], D = "";
          v.cell_template && (D = e.templates[v.name + "_cell_value"](p, v._trace_x[c], E, w));
          var S = "line-height:" + v._section_height[E.key] + "px;";
          let N = "";
          return D && (N = "<div style='width:auto; height:100%;position:relative;" + S + "'>" + D + "</div>"), "<div class='dhx_matrix_cell dhx_timeline_data_cell " + e.templates[v.name + "_cell_class"](p, v._trace_x[c], E, w) + "' style='width:" + e._cols[c] + "px; " + (e.config.rtl ? "right:" : "left:") + x + "px;'  data-col-id='" + c + "' data-col-date='" + k + "' >" + N + "</div>";
        }, e._timeline_render_scale_header = function(c, g) {
          var v = e.$container.querySelector(".dhx_timeline_scale_header");
          if (v && v.remove(), !g)
            return;
          v = document.createElement("div");
          var p = "dhx_timeline_scale_header";
          c.second_scale && (p += " dhx_timeline_second_scale");
          var x = e.xy.scale_height;
          v.className = p, v.style.cssText = ["width:" + c.dx + "px", "height:" + x + "px", "line-height:" + x + "px", "top:0px", e.config.rtl ? "right:0px" : "left:0px"].join(";"), v.innerHTML = e.templates[c.name + "_scale_header"](c);
          const w = e.$container.querySelector(".dhx_cal_header");
          v.style.top = `${w.offsetTop}px`, v.style.height = `${w.offsetHeight}px`, e.$container.appendChild(v);
        }, e._timeline_y_scale = function(c) {
          var g = e._timeline_get_block_stats(c, this), v = this.scrollable ? " dhx_timeline_scrollable_data" : "", p = "<div class='dhx_timeline_table_wrapper'>", x = "<div class='dhx_timeline_label_wrapper' style='" + g.style_label_wrapper + "'><div class='dhx_timeline_label_col'>", w = "<div class='dhx_timeline_data_wrapper" + v + "' style='" + g.style_data_wrapper + "'><div class='dhx_timeline_data_col'>";
          e._load_mode && e._load(), e._timeline_smart_render.clearPreparedEventsCache(k);
          var k = e._timeline_smart_render.getPreparedEvents(this);
          e._timeline_smart_render.cachePreparedEvents(k);
          for (var E = 0, D = 0; D < e._cols.length; D++)
            E += e._cols[D];
          var S = /* @__PURE__ */ new Date(), N = e._cols.length - e._ignores_detected;
          S = (e.date.add(S, this.x_step * N, this.x_unit) - S - (this._start_correction + this._end_correction) * N) / E, this._step = S, this._summ = E;
          var A = e._colsS.heights = [], M = [];
          this._render_stats = M, this._events_height = {}, this._section_height = {}, this._label_rows = [];
          var C = !1, T = null;
          (this.scrollable || this.smart_rendering) && (T = e._timeline_smart_render.getViewPort(this.scrollHelper, this._sch_height)), e._timeline_smart_render._rendered_labels_cache = [], e._timeline_smart_render._rendered_events_cache = [];
          var O = !!T, L = this._smartRenderingEnabled(), $ = function(F, H) {
            for (var ge = [], q = {}, ne = 0, K = 0; K < F.y_unit.length; K++) {
              e._timeline_calculate_event_positions.call(F, H[K]);
              var ie = e._timeline_get_cur_row_stats(F, K);
              (ie = e._timeline_get_fit_events_stats(F, K, ie)).top = ne, ge.push(ie), q[F.y_unit[K].key] = ie, ne += ie.height;
            }
            return { totalHeight: ne, rowStats: ge, rowStatsByKey: q };
          }(this, k);
          T && $.totalHeight < T.scrollTop && (T.scrollTop = Math.max(0, $.totalHeight - T.height)), this._rowStats = $.rowStatsByKey;
          for (var P = 0; P < this.y_unit.length; P++) {
            var j = $.rowStats[P], I = this.y_unit[P], Y = j.top, J = "<div class='dhx_timeline_label_row " + j.tr_className + "' style='top:" + Y + "px;" + j.style_height + j.style_line_height + "'data-row-index='" + P + "' data-row-id='" + d(I.key) + "'><div class='" + j.td_className + "' style='" + j.style_width + " height:" + j.height + "px;' " + e._waiAria.label(j.td_content) + ">" + j.td_content + "</div></div>";
            if (L && this._label_rows.push({ div: J, top: Y, section: I }), L && (e._timeline_smart_render.isInYViewPort({ top: Y, bottom: Y + j.height }, T) || (C = !0)), C)
              C = !1;
            else {
              x += J, L && e._timeline_smart_render._rendered_labels_cache.push(P);
              var Q = { view: this, section: I, template: e.templates[this.name + "_row_class"] }, R = 0;
              if (this.render == "cell") {
                w += e._timeline_get_html_for_cell_data_row(P, j, j.top, I.key, Q);
                for (var V = 0; V < e._cols.length; V++)
                  e._ignores[V] && !L ? w += e._timeline_get_html_for_cell_ignores(j) : L && O ? e._timeline_smart_render.isInXViewPort({ left: R, right: R + e._cols[V] }, T) && (w += e._timeline_get_html_for_cell(V, P, this, k[P][V], j, R)) : w += e._timeline_get_html_for_cell(V, P, this, k[P][V], j, R), R += e._cols[V];
                w += "</div>";
              } else {
                w += e._timeline_get_html_for_bar_matrix_line(P, j, j.top, I.key);
                var W = k[P];
                for (L && O && (W = e._timeline_smart_render.getVisibleEventsForRow(this, T, k, P)), w += e._timeline_get_events_html.call(this, W), w += e._timeline_get_html_for_bar_data_row(j, Q), V = 0; V < e._cols.length; V++)
                  e._ignores[V] ? w += e._timeline_get_html_for_bar_ignores() : L && O ? e._timeline_smart_render.isInXViewPort({ left: R, right: R + e._cols[V] }, T) && (w += e._timeline_get_html_for_bar(V, P, this, k[P], R)) : w += e._timeline_get_html_for_bar(V, P, this, k[P], R), R += e._cols[V];
                w += "</div></div>";
              }
            }
            j.sectionKey = I.key, M.push(j);
          }
          p += x + "</div></div>", p += w + "</div></div>", p += "</div>", this._matrix = k, c.innerHTML = p, L && e._timeline_smart_render && (e._timeline_smart_render._rendered_events_cache = []), e._populate_timeline_rendered(c);
          const ue = c.querySelectorAll("[data-section-id]"), fe = {};
          ue.forEach(function(F) {
            fe[F.getAttribute("data-section-id")] = F;
          }), this._divBySectionId = fe, L && (e.$container.querySelector(".dhx_timeline_data_col").style.height = $.totalHeight + "px"), this._scales = {}, D = 0;
          for (var pe = M.length; D < pe; D++) {
            A.push(M[D].height);
            var re = M[D].sectionKey;
            e._timeline_finalize_section_add(this, re, this._divBySectionId[re]);
          }
          (L || this.scrollable) && function(F, H, ge) {
            H._is_ev_creating = !1;
            var q = _(F, H), ne = e._els.dhx_cal_header[0], K = F.querySelector(".dhx_timeline_label_wrapper");
            if (K && !K.$eventsAttached) {
              K.$eventsAttached = !0;
              var ie = { pageX: 0, pageY: 0 };
              e.event(K, "touchstart", function(G) {
                var ae = G;
                G.touches && (ae = G.touches[0]), ie = { pageX: ae.pageX, pageY: ae.pageY };
              }, { passive: !1 }), e.event(K, "touchmove", function(G) {
                var ae = G;
                G.touches && (ae = G.touches[0]);
                var ve = ie.pageY - ae.pageY;
                ie = { pageX: ae.pageX, pageY: ae.pageY }, ve && (q.scrollTop += ve), G && G.preventDefault && G.preventDefault();
              }, { passive: !1 });
            }
            if (!q.$eventsAttached) {
              let ve = function(B) {
                let X = !0;
                var Z = e.env.isFF, U = Z ? B.deltaX : B.wheelDeltaX, ee = Z ? B.deltaY : B.wheelDelta, te = -20;
                Z && (te = B.deltaMode !== 0 ? -40 : -10);
                var _e = 1, le = 1, me = Z ? U * te * _e : 2 * U * _e, oe = Z ? ee * te * le : ee * le;
                if (me && Math.abs(me) > Math.abs(oe)) {
                  var ce = me / -40;
                  q.scrollLeft += 30 * ce, q.scrollLeft === G && (X = !1);
                } else
                  ce = oe / -40, oe === void 0 && (ce = B.detail), q.scrollTop += 30 * ce, q.scrollTop === ae && (X = !1);
                if (X)
                  return B.preventDefault(), B.cancelBubble = !0, !1;
              }, G, ae;
              q.$eventsAttached = !0, e.event(q, "mousewheel", ve, { passive: !1 }), e.event(K, "mousewheel", ve, { passive: !1 }), e.event(q, "scroll", function(B) {
                if (e.getState().mode === H.name) {
                  var X = _(F, H);
                  B.preventDefault();
                  var Z = X.scrollTop, U = H.scrollHelper.getScrollValue(X);
                  G = U, ae = Z;
                  var ee = H._summ - e.$container.querySelector(".dhx_cal_data").offsetWidth + H.dx + H.custom_scroll_width, te = e._timeline_smart_render.getViewPort(H.scrollHelper, 0, U, Z), _e = l();
                  if (H.scrollable && (_e.style.top = -Z + "px"), H.smart_rendering !== !1) {
                    if ((U !== H._x_scroll || H._is_ev_creating) && (H.second_scale ? e._timeline_smart_render.updateHeader(H, te, ne.children[1]) : e._timeline_smart_render.updateHeader(H, te, ne.children[0])), e.config.rtl) {
                      var le = +e.$container.querySelector(".dhx_timeline_label_wrapper").style.height.replace("px", ""), me = H._section_height[H.y_unit.length] + H._label_rows[H._label_rows.length - 1].top;
                      H.scrollHelper.getMode() == H.scrollHelper.modes.minMax && (me > le || H.render == "tree") ? ne.style.right = -1 - U - a() + "px" : ne.style.right = -1 - U + "px", ne.style.left = "unset";
                    } else
                      ne.style.left = -1 - U + "px";
                    if ((H._options_changed || Z !== H._y_scroll || H._is_ev_creating) && e._timeline_smart_render.updateLabels(H, te, _e), H._is_ev_creating = !1, e._timeline_smart_render.updateGridCols(H, te), e._timeline_smart_render.updateGridRows(H, te), H.render != "cell") {
                      if (cancelAnimationFrame(void 0), H.name !== e.getState().mode)
                        return;
                      e._timeline_smart_render.updateEvents(H, te);
                    }
                    var oe, ce = 0;
                    H._scales = {}, oe = H.render === "cell" ? X.querySelectorAll(".dhx_timeline_data_col .dhx_timeline_data_row") : X.querySelectorAll(".dhx_timeline_data_col .dhx_matrix_line");
                    for (var Se = H._render_stats, se = 0, xe = oe.length; se < xe; se++) {
                      var we = oe[se].getAttribute("data-section-id"), ke = H.order[we];
                      ge[ke] = Se[ke].height, H._scales[we] = oe[se];
                    }
                    for (se = 0, xe = ge.length; se < xe; se++)
                      ce += ge[se];
                    e.$container.querySelector(".dhx_timeline_data_col").style.height = ce + "px";
                    var Ee = Z, De = U;
                    e._timeline_save_scroll_pos(H, Ee, De, ee), H.callEvent("onScroll", [De, Ee]), H._is_new_view = !1;
                  }
                }
              }, { passive: !1 });
              var ye = { pageX: 0, pageY: 0 };
              e.event(q, "touchstart", function(B) {
                var X = B;
                B.touches && (X = B.touches[0]), ye = { pageX: X.pageX, pageY: X.pageY };
              }, { passive: !1 }), e.event(q, "touchmove", function(B) {
                var X = B;
                B.touches && (X = B.touches[0]);
                var Z = l(), U = ye.pageX - X.pageX, ee = ye.pageY - X.pageY;
                if (ye = { pageX: X.pageX, pageY: X.pageY }, (U || ee) && !e.getState().drag_id) {
                  var te = Math.abs(U), _e = Math.abs(ee), le = Math.sqrt(U * U + ee * ee);
                  te / le < 0.42 ? U = 0 : _e / le < 0.42 && (ee = 0), H.scrollHelper.setScrollValue(q, H.scrollHelper.getScrollValue(q) + U), q.scrollTop += ee, H.scrollable && ee && (Z.style.top = -q.scrollTop + "px");
                }
                return B && B.preventDefault && B.preventDefault(), !1;
              }, { passive: !1 });
            }
            H.scroll_position && H._is_new_view ? H.scrollTo(H.scroll_position) : e._timeline_set_scroll_pos(F, H), H._is_ev_creating = !0;
          }(c, this, A);
        }, e._timeline_finalize_section_add = function(c, g, v) {
          v && (c._scales[g] = v, e.callEvent("onScaleAdd", [v, g]));
        }, e.attachEvent("onBeforeViewChange", function(c, g, v, p) {
          if (e.matrix[v]) {
            var x = e.matrix[v];
            if (x.scrollable) {
              if (x.render == "tree" && c === v && g === p)
                return !0;
              x._x_scroll = x._y_scroll = 0, e.$container.querySelector(".dhx_timeline_scrollable_data") && e._timeline_set_scroll_pos(e._els.dhx_cal_data[0], x);
            }
          }
          return !0;
        }), e._timeline_x_dates = function(c) {
          var g = e._min_date, v = e._max_date;
          e._process_ignores(g, this.x_size, this.x_unit, this.x_step, c), e.date[this.x_unit + "_start"] && (g = e.date[this.x_unit + "_start"](g));
          for (var p = 0, x = 0; +g < +v; )
            if (this._trace_x[x] = new Date(g), this.x_unit == "month" && e.date[this.x_unit + "_start"] && (g = e.date[this.x_unit + "_start"](new Date(g))), g = e.date.add(g, this.x_step, this.x_unit), e.date[this.x_unit + "_start"] && (g = e.date[this.x_unit + "_start"](g)), e._ignores[x] || p++, x++, c) {
              if (p < this.x_size && !(+g < +v))
                v = e.date["add_" + this.name + "_private"](v, (this.x_length || this.x_size) * this.x_step);
              else if (p >= this.x_size) {
                e._max_date = g;
                break;
              }
            }
          return { total: x, displayed: p };
        }, e._timeline_x_scale = function(c) {
          var g = e._x - this.dx - e.xy.scroll_width, v = e._min_date, p = e.xy.scale_height, x = this._header_resized || e.xy.scale_height;
          e._cols = [], e._colsS = { height: 0 }, this._trace_x = [];
          var w = e.config.preserve_scale_length, k = e._timeline_x_dates.call(this, w);
          if (this.scrollable && this.column_width > 0) {
            var E = this.column_width * k.displayed;
            E > g && (g = E, this._section_autowidth = !1);
          }
          var D = [this.dx];
          e._els.dhx_cal_header[0].style.width = D[0] + g + 1 + "px", v = e._min_date_timeline = e._min_date;
          for (var S = k.displayed, N = k.total, A = 0; A < N; A++)
            e._ignores[A] ? (e._cols[A] = 0, S++) : e._cols[A] = Math.floor(g / (S - A)), g -= e._cols[A], D[A + 1] = D[A] + e._cols[A];
          if (c.innerHTML = "<div></div>", this.second_scale) {
            for (var M = this.second_scale.x_unit, C = [this._trace_x[0]], T = [], O = [this.dx, this.dx], L = 0, $ = 0; $ < this._trace_x.length; $++) {
              var P = this._trace_x[$];
              e._timeline_is_new_interval(M, P, C[L]) && (C[++L] = P, O[L + 1] = O[L]);
              var j = L + 1;
              T[L] = e._cols[$] + (T[L] || 0), O[j] += e._cols[$];
            }
            c.innerHTML = "<div></div><div></div>";
            var I = c.firstChild;
            I.style.height = x + "px";
            var Y = c.lastChild;
            Y.style.position = "relative", Y.className = "dhx_bottom_scale_container";
            for (var J = 0; J < C.length; J++) {
              var Q = C[J], R = e.templates[this.name + "_second_scalex_class"](Q), V = document.createElement("div");
              V.className = "dhx_scale_bar dhx_second_scale_bar" + (R ? " " + R : ""), e.set_xy(V, T[J], x, O[J], 0), V.innerHTML = e.templates[this.name + "_second_scale_date"](Q), I.appendChild(V);
            }
          }
          e.xy.scale_height = x, c = c.lastChild, this._h_cols = {};
          for (var W = 0; W < this._trace_x.length; W++)
            if (!e._ignores[W]) {
              v = this._trace_x[W], e._render_x_header(W, D[W], v, c);
              var ue = e.templates[this.name + "_scalex_class"](v);
              ue && (c.lastChild.className += " " + ue), c.lastChild.setAttribute("data-col-id", W), c.lastChild.setAttribute("data-col-date", s(v));
              var fe = c.lastChild.cloneNode(!0);
              this._h_cols[W] = { div: fe, left: D[W] };
            }
          e.xy.scale_height = p;
          var pe = this._trace_x;
          c.$_clickEventsAttached || (c.$_clickEventsAttached = !0, e.event(c, "click", function(re) {
            var F = e._timeline_locate_hcell(re);
            F && e.callEvent("onXScaleClick", [F.x, pe[F.x], re]);
          }), e.event(c, "dblclick", function(re) {
            var F = e._timeline_locate_hcell(re);
            F && e.callEvent("onXScaleDblClick", [F.x, pe[F.x], re]);
          }));
        }, e._timeline_is_new_interval = function(c, g, v) {
          switch (c) {
            case "hour":
              return g.getHours() != v.getHours() || e._timeline_is_new_interval("day", g, v);
            case "day":
              return !(g.getDate() == v.getDate() && g.getMonth() == v.getMonth() && g.getFullYear() == v.getFullYear());
            case "week":
              return e.date.week_start(new Date(g)).valueOf() != e.date.week_start(new Date(v)).valueOf();
            case "month":
              return !(g.getMonth() == v.getMonth() && g.getFullYear() == v.getFullYear());
            case "year":
              return g.getFullYear() != v.getFullYear();
            default:
              return !1;
          }
        }, e._timeline_reset_scale_height = function(c) {
          if (this._header_resized && (!c || this.second_scale)) {
            e.xy.scale_height /= 2, this._header_resized = !1;
            var g = e._els.dhx_cal_header[0];
            g.className = g.className.replace(/ dhx_second_cal_header/gi, "");
          }
        }, e._timeline_set_full_view = function(c) {
          if (e._timeline_reset_scale_height.call(this, c), c) {
            this.second_scale && !this._header_resized && (this._header_resized = e.xy.scale_height, e.xy.scale_height *= 2, e._els.dhx_cal_header[0].className += " dhx_second_cal_header"), e.set_sizes(), e._init_matrix_tooltip();
            var g = e._min_date;
            if (e._timeline_x_scale.call(this, e._els.dhx_cal_header[0]), e.$container.querySelector(".dhx_timeline_scrollable_data")) {
              var v = e._timeline_smart_render.getViewPort(this.scrollHelper), p = e._timeline_smart_render.getVisibleHeader(this, v);
              p && (this.second_scale ? e._els.dhx_cal_header[0].children[1].innerHTML = p : e._els.dhx_cal_header[0].children[0].innerHTML = p);
            }
            e._timeline_y_scale.call(this, e._els.dhx_cal_data[0]), e._min_date = g;
            var x = e._getNavDateElement();
            x && (x.innerHTML = e.templates[this.name + "_date"](e._min_date, e._max_date)), e._mark_now && e._mark_now(), e._timeline_reset_scale_height.call(this, c);
          }
          e._timeline_render_scale_header(this, c), e._timeline_hideToolTip();
        }, e._timeline_hideToolTip = function() {
          e._tooltip && (e._tooltip.style.display = "none", e._tooltip.date = "");
        }, e._timeline_showToolTip = function(c, g, v) {
          if (c.render == "cell") {
            var p = g.x + "_" + g.y, x = c._matrix[g.y][g.x];
            if (!x)
              return e._timeline_hideToolTip();
            if (x.sort(function(N, A) {
              return N.start_date > A.start_date ? 1 : -1;
            }), e._tooltip) {
              if (e._tooltip.date == p)
                return;
              e._tooltip.innerHTML = "";
            } else {
              var w = e._tooltip = document.createElement("div");
              w.className = "dhx_year_tooltip", e.config.rtl && (w.className += " dhx_tooltip_rtl"), document.body.appendChild(w), e.event(w, "click", e._click.dhx_cal_data);
            }
            for (var k = "", E = 0; E < x.length; E++) {
              var D = x[E].color ? "--dhx-scheduler-event-color:" + x[E].color + ";" : "", S = x[E].textColor ? "--dhx-scheduler-event-background:" + x[E].textColor + ";" : "";
              k += "<div class='dhx_tooltip_line' event_id='" + x[E].id + "' " + e.config.event_attribute + "='" + x[E].id + "' style='" + D + S + "'>", k += "<div class='dhx_tooltip_date'>" + (x[E]._timed ? e.templates.event_date(x[E].start_date) : "") + "</div>", k += "<div class='dhx_event_icon icon_details'>&nbsp;</div>", k += e.templates[c.name + "_tooltip"](x[E].start_date, x[E].end_date, x[E]) + "</div>";
            }
            e._tooltip.style.display = "", e._tooltip.style.top = "0px", e.config.rtl && v.left - e._tooltip.offsetWidth >= 0 || document.body.offsetWidth - g.src.offsetWidth - v.left - e._tooltip.offsetWidth < 0 ? e._tooltip.style.left = v.left - e._tooltip.offsetWidth + "px" : e._tooltip.style.left = v.left + g.src.offsetWidth + "px", e._tooltip.date = p, e._tooltip.innerHTML = k, document.body.offsetHeight - v.top - e._tooltip.offsetHeight < 0 ? e._tooltip.style.top = v.top - e._tooltip.offsetHeight + g.src.offsetHeight + "px" : e._tooltip.style.top = v.top + "px";
          }
        }, e._matrix_tooltip_handler = function(c) {
          var g = e.matrix[e._mode];
          if (g && g.render == "cell") {
            if (g) {
              var v = e._locate_cell_timeline(c);
              if (v)
                return e._timeline_showToolTip(g, v, e.$domHelpers.getOffset(v.src));
            }
            e._timeline_hideToolTip();
          }
        }, e._init_matrix_tooltip = function() {
          e._detachDomEvent(e._els.dhx_cal_data[0], "mouseover", e._matrix_tooltip_handler), e.event(e._els.dhx_cal_data[0], "mouseover", e._matrix_tooltip_handler);
        }, e._set_timeline_dates = function(c) {
          e._min_date = e.date[c.name + "_start"](new Date(e._date)), e._max_date = e.date["add_" + c.name + "_private"](e._min_date, c.x_size * c.x_step), e.date[c.x_unit + "_start"] && (e._max_date = e.date[c.x_unit + "_start"](e._max_date)), e._table_view = !0;
        }, e._renderMatrix = function(c, g) {
          this.callEvent("onBeforeRender", []), g || (e._els.dhx_cal_data[0].scrollTop = 0), e._set_timeline_dates(this), e._timeline_set_full_view.call(this, c);
        }, e._timeline_html_index = function(c) {
          for (var g = c.parentNode.childNodes, v = -1, p = 0; p < g.length; p++)
            if (g[p] == c) {
              v = p;
              break;
            }
          var x = v;
          if (e._ignores_detected)
            for (var w in e._ignores)
              e._ignores[w] && 1 * w <= x && x++;
          return x;
        }, e._timeline_locate_hcell = function(c) {
          for (var g = c.target ? c.target : c.srcElement; g && g.tagName != "DIV"; )
            g = g.parentNode;
          if (g && g.tagName == "DIV" && e._getClassName(g).split(" ")[0] == "dhx_scale_bar")
            return { x: e._timeline_html_index(g), y: -1, src: g, scale: !0 };
        }, e._locate_cell_timeline = function(c) {
          for (var g = c.target ? c.target : c.srcElement, v = {}, p = e.matrix[e._mode], x = e.getActionData(c), w = e._ignores, k = 0, E = 0; E < p._trace_x.length - 1 && !(+x.date < p._trace_x[E + 1]); E++)
            w[E] || k++;
          v.x = k === 0 ? 0 : E, v.y = p.order[x.section];
          var D = 0;
          if (p.scrollable && p.render === "cell") {
            if (!p._scales[x.section] || !p._scales[x.section].querySelector(".dhx_matrix_cell"))
              return;
            var S = p._scales[x.section].querySelector(".dhx_matrix_cell");
            if (!S)
              return;
            var N = S.offsetLeft;
            if (N > 0) {
              for (var A = e._timeline_drag_date(p, N), M = 0; M < p._trace_x.length - 1 && !(+A < p._trace_x[M + 1]); M++)
                ;
              D = M;
            }
          }
          v.src = p._scales[x.section] ? p._scales[x.section].querySelectorAll(".dhx_matrix_cell")[E - D] : null;
          var C, T, O = !1, L = (C = g, T = ".dhx_matrix_scell", e.$domHelpers.closest(C, T));
          return L && (g = L, O = !0), O ? (v.x = -1, v.src = g, v.scale = !0) : v.x = E, v;
        };
        var h = e._click.dhx_cal_data;
        e._click.dhx_marked_timespan = e._click.dhx_cal_data = function(c) {
          var g = h.apply(this, arguments), v = e.matrix[e._mode];
          if (v) {
            var p = e._locate_cell_timeline(c);
            p && (p.scale ? e.callEvent("onYScaleClick", [p.y, v.y_unit[p.y], c]) : (e.callEvent("onCellClick", [p.x, p.y, v._trace_x[p.x], (v._matrix[p.y] || {})[p.x] || [], c]), e._timeline_set_scroll_pos(e._els.dhx_cal_data[0], v)));
          }
          return g;
        }, e.dblclick_dhx_matrix_cell = function(c) {
          var g = e.matrix[e._mode];
          if (g) {
            var v = e._locate_cell_timeline(c);
            v && (v.scale ? e.callEvent("onYScaleDblClick", [v.y, g.y_unit[v.y], c]) : e.callEvent("onCellDblClick", [v.x, v.y, g._trace_x[v.x], (g._matrix[v.y] || {})[v.x] || [], c]));
          }
        };
        var u = e.dblclick_dhx_marked_timespan || function() {
        };
        e.dblclick_dhx_marked_timespan = function(c) {
          return e.matrix[e._mode] ? e.dblclick_dhx_matrix_cell(c) : u.apply(this, arguments);
        }, e.dblclick_dhx_matrix_scell = function(c) {
          return e.dblclick_dhx_matrix_cell(c);
        }, e._isRender = function(c) {
          return e.matrix[e._mode] && e.matrix[e._mode].render == c;
        }, e.attachEvent("onCellDblClick", function(c, g, v, p, x) {
          if (!this.config.readonly && (x.type != "dblclick" || this.config.dblclick_create)) {
            var w = e.matrix[e._mode], k = {};
            k.start_date = w._trace_x[c], k.end_date = w._trace_x[c + 1] ? w._trace_x[c + 1] : e.date.add(w._trace_x[c], w.x_step, w.x_unit), w._start_correction && (k.start_date = new Date(1 * k.start_date + w._start_correction)), w._end_correction && (k.end_date = new Date(k.end_date - w._end_correction)), k[w.y_property] = w.y_unit[g].key, e.addEventNow(k, null, x);
          }
        }), e.attachEvent("onBeforeDrag", function(c, g, v) {
          return !e._isRender("cell");
        }), e.attachEvent("onEventChanged", function(c, g) {
          g._timed = this.isOneDayEvent(g);
        }), e.attachEvent("onBeforeEventChanged", function(c, g, v, p) {
          return c && (c._move_delta = void 0), p && (p._move_delta = void 0), !0;
        }), e._is_column_visible = function(c) {
          var g = e.matrix[e._mode], v = e._get_date_index(g, c);
          return !e._ignores[v];
        };
        var m = e._render_marked_timespan;
        e._render_marked_timespan = function(c, g, v, p, x) {
          if (!e.config.display_marked_timespans)
            return [];
          if (e.matrix && e.matrix[e._mode]) {
            if (e._isRender("cell"))
              return;
            var w = e._lame_copy({}, e.matrix[e._mode]);
            w.round_position = !1;
            var k = [], E = [], D = [], S = c.sections ? c.sections.units || c.sections.timeline : null;
            if (v)
              D = [g], E = [v];
            else {
              var N = w.order;
              if (S)
                N.hasOwnProperty(S) && (E.push(S), D.push(w._scales[S]));
              else if (w._scales)
                for (var A in N)
                  N.hasOwnProperty(A) && w._scales[A] && (E.push(A), D.push(w._scales[A]));
            }
            if (p = p ? new Date(p) : e._min_date, x = x ? new Date(x) : e._max_date, p.valueOf() < e._min_date.valueOf() && (p = new Date(e._min_date)), x.valueOf() > e._max_date.valueOf() && (x = new Date(e._max_date)), !w._trace_x)
              return;
            for (var M = 0; M < w._trace_x.length && !e._is_column_visible(w._trace_x[M]); M++)
              ;
            if (M == w._trace_x.length)
              return;
            var C = [];
            if (c.days > 6) {
              var T = new Date(c.days);
              e.date.date_part(new Date(p)) <= +T && +x >= +T && C.push(T);
            } else
              C.push.apply(C, e._get_dates_by_index(c.days));
            for (var O = c.zones, L = e._get_css_classes_by_config(c), $ = 0; $ < E.length; $++)
              for (g = D[$], v = E[$], M = 0; M < C.length; M++)
                for (var P = C[M], j = 0; j < O.length; j += 2) {
                  var I = O[j], Y = O[j + 1], J = new Date(+P + 60 * I * 1e3), Q = new Date(+P + 60 * Y * 1e3);
                  if (J = new Date(J.valueOf() + 1e3 * (J.getTimezoneOffset() - P.getTimezoneOffset()) * 60), p < (Q = new Date(Q.valueOf() + 1e3 * (Q.getTimezoneOffset() - P.getTimezoneOffset()) * 60)) && x > J) {
                    var R = e._get_block_by_config(c);
                    R.className = L;
                    var V = e._timeline_getX({ start_date: J }, !1, w) - 1, W = e._timeline_getX({ start_date: Q }, !1, w) - 1, ue = Math.max(1, W - V - 1), fe = w._section_height[v] - 1 || w.dy - 1;
                    R.style.cssText = "height: " + fe + "px; " + (e.config.rtl ? "right: " : "left: ") + V + "px; width: " + ue + "px; top: 0;", g.insertBefore(R, g.firstChild), k.push(R);
                  }
                }
            return k;
          }
          return m.apply(e, [c, g, v]);
        };
        var f = e._append_mark_now;
        e._append_mark_now = function(c, g) {
          if (e.matrix && e.matrix[e._mode]) {
            var v = e._currentDate(), p = e._get_zone_minutes(v), x = { days: +e.date.date_part(v), zones: [p, p + 1], css: "dhx_matrix_now_time", type: "dhx_now_time" };
            return e._render_marked_timespan(x);
          }
          return f.apply(e, [c, g]);
        };
        var y = e._mark_timespans;
        e._mark_timespans = function() {
          if (e.matrix && e.matrix[e.getState().mode]) {
            for (var c = [], g = e.matrix[e.getState().mode], v = g.y_unit, p = 0; p < v.length; p++) {
              var x = v[p].key, w = g._scales[x], k = e._on_scale_add_marker(w, x);
              c.push.apply(c, k);
            }
            return c;
          }
          return y.apply(this, arguments);
        };
        var b = e._on_scale_add_marker;
        e._on_scale_add_marker = function(c, g) {
          if (e.matrix && e.matrix[e._mode]) {
            var v = [], p = e._marked_timespans;
            if (p && e.matrix && e.matrix[e._mode])
              for (var x = e._mode, w = e._min_date, k = e._max_date, E = p.global, D = e.date.date_part(new Date(w)); D < k; D = e.date.add(D, 1, "day")) {
                var S = +D, N = D.getDay(), A = [];
                if (e.config.overwrite_marked_timespans) {
                  var M = E[S] || E[N];
                  A.push.apply(A, e._get_configs_to_render(M));
                } else
                  E[S] && A.push.apply(A, e._get_configs_to_render(E[S])), E[N] && A.push.apply(A, e._get_configs_to_render(E[N]));
                if (p[x] && p[x][g]) {
                  var C = [], T = e._get_types_to_render(p[x][g][N], p[x][g][S]);
                  C.push.apply(C, e._get_configs_to_render(T)), e.config.overwrite_marked_timespans ? C.length && (A = C) : A = A.concat(C);
                }
                for (var O = 0; O < A.length; O++) {
                  var L = A[O], $ = L.days;
                  $ < 7 ? ($ = S, v.push.apply(v, e._render_marked_timespan(L, c, g, D, e.date.add(D, 1, "day"))), $ = N) : v.push.apply(v, e._render_marked_timespan(L, c, g, D, e.date.add(D, 1, "day")));
                }
              }
            return v;
          }
          return b.apply(this, arguments);
        }, e._resolve_timeline_section = function(c, g) {
          for (var v = 0, p = 0; v < this._colsS.heights.length && !((p += this._colsS.heights[v]) > g.y); v++)
            ;
          c.y_unit[v] || (v = c.y_unit.length - 1), this._drag_event && !this._drag_event._orig_section && (this._drag_event._orig_section = c.y_unit[v].key), g.fields = {}, v >= 0 && c.y_unit[v] && (g.section = g.fields[c.y_property] = c.y_unit[v].key);
        }, e._update_timeline_section = function(c) {
          var g = c.view, v = c.event, p = c.pos;
          if (v) {
            if (v[g.y_property] != p.section) {
              var x = this._get_timeline_event_height ? this._get_timeline_event_height(v, g) : g.getEventHeight(v);
              v._sorder = this._get_dnd_order(v._sorder, x, g.getSectionHeight(p.section));
            }
            v[g.y_property] = p.section;
          }
        }, e._get_date_index = function(c, g) {
          for (var v = c._trace_x, p = 0, x = v.length - 1, w = g.valueOf(); x - p > 3; ) {
            var k = p + Math.floor((x - p) / 2);
            v[k].valueOf() > w ? x = k : p = k;
          }
          for (var E = p; E <= x && +g >= +v[E + 1]; )
            E++;
          return E;
        }, e._timeline_drag_date = function(c, g) {
          var v = c, p = g;
          if (!v._trace_x.length)
            return new Date(e.getState().date);
          for (var x, w, k, E = 0, D = 0; D <= this._cols.length - 1; D++)
            if ((E += w = this._cols[D]) > p) {
              x = (x = (p - (E - w)) / w) < 0 ? 0 : x;
              break;
            }
          if (v.round_position) {
            var S = 1, N = e.getState().drag_mode;
            N && N != "move" && N != "create" && (S = 0.5), x >= S && D++, x = 0;
          }
          if (D === 0 && this._ignores[0])
            for (D = 1, x = 0; this._ignores[D]; )
              D++;
          else if (D == this._cols.length && this._ignores[D - 1]) {
            for (D = this._cols.length - 1, x = 0; this._ignores[D]; )
              D--;
            D++;
          }
          if (D >= v._trace_x.length)
            k = e.date.add(v._trace_x[v._trace_x.length - 1], v.x_step, v.x_unit), v._end_correction && (k = new Date(k - v._end_correction));
          else {
            var A = x * w * v._step + v._start_correction;
            k = new Date(+v._trace_x[D] + A);
          }
          return k;
        }, e.attachEvent("onBeforeTodayDisplayed", function() {
          for (var c in e.matrix) {
            var g = e.matrix[c];
            g.x_start = g._original_x_start;
          }
          return !0;
        }), e.attachEvent("onOptionsLoad", function() {
          for (var c in e.matrix) {
            var g = e.matrix[c];
            for (g.order = {}, e.callEvent("onOptionsLoadStart", []), c = 0; c < g.y_unit.length; c++)
              g.order[g.y_unit[c].key] = c;
            e.callEvent("onOptionsLoadFinal", []), e._date && g.name == e._mode && (g._options_changed = !0, e.setCurrentView(e._date, e._mode), setTimeout(function() {
              g._options_changed = !1;
            }));
          }
        }), e.attachEvent("onEventIdChange", function() {
          var c = e.getView();
          c && e.matrix[c.name] && e._timeline_smart_render && (e._timeline_smart_render.clearPreparedEventsCache(), e._timeline_smart_render.getPreparedEvents(c));
        }), e.attachEvent("onBeforeDrag", function(c, g, v) {
          if (g == "resize") {
            var p = v.target || v.srcElement;
            e._getClassName(p).indexOf("dhx_event_resize_end") < 0 ? e._drag_from_start = !0 : e._drag_from_start = !1;
          }
          return !0;
        }), autoscroll(e), smartRender(e);
      }, e._temp_matrix_scope();
    }
    class Tooltip {
      constructor(a) {
        this._scheduler = a;
      }
      getNode() {
        const a = this._scheduler;
        return this._tooltipNode || (this._tooltipNode = document.createElement("div"), this._tooltipNode.className = "dhtmlXTooltip scheduler_tooltip tooltip", a._waiAria.tooltipAttr(this._tooltipNode)), a.config.rtl ? this._tooltipNode.classList.add("dhtmlXTooltip_rtl") : this._tooltipNode.classList.remove("dhtmlXTooltip_rtl"), this._tooltipNode;
      }
      setViewport(a) {
        return this._root = a, this;
      }
      show(a, t) {
        const n = this._scheduler, o = n.$domHelpers, r = document.body, d = this.getNode();
        if (o.isChildOf(d, r) || (this.hide(), r.appendChild(d)), this._isLikeMouseEvent(a)) {
          const i = this._calculateTooltipPosition(a);
          t = i.top, a = i.left;
        }
        return d.style.top = t + "px", d.style.left = a + "px", n._waiAria.tooltipVisibleAttr(d), this;
      }
      hide() {
        const a = this._scheduler, t = this.getNode();
        return t && t.parentNode && t.parentNode.removeChild(t), a._waiAria.tooltipHiddenAttr(t), this;
      }
      setContent(a) {
        return this.getNode().innerHTML = a, this;
      }
      _isLikeMouseEvent(a) {
        return !(!a || typeof a != "object") && "clientX" in a && "clientY" in a;
      }
      _getViewPort() {
        return this._root || document.body;
      }
      _calculateTooltipPosition(a) {
        const t = this._scheduler, n = t.$domHelpers, o = this._getViewPortSize(), r = this.getNode(), d = { top: 0, left: 0, width: r.offsetWidth, height: r.offsetHeight, bottom: 0, right: 0 }, i = t.config.tooltip_offset_x, s = t.config.tooltip_offset_y, _ = document.body, l = n.getRelativeEventPosition(a, _), h = n.getNodePosition(_);
        l.y += h.y, d.top = l.y, d.left = l.x, d.top += s, d.left += i, d.bottom = d.top + d.height, d.right = d.left + d.width;
        const u = window.scrollY + _.scrollTop;
        return d.top < o.top - u ? (d.top = o.top, d.bottom = d.top + d.height) : d.bottom > o.bottom && (d.bottom = o.bottom, d.top = d.bottom - d.height), d.left < o.left ? (d.left = o.left, d.right = o.left + d.width) : d.right > o.right && (d.right = o.right, d.left = d.right - d.width), l.x >= d.left && l.x <= d.right && (d.left = l.x - d.width - i, d.right = d.left + d.width), l.y >= d.top && l.y <= d.bottom && (d.top = l.y - d.height - s, d.bottom = d.top + d.height), d;
      }
      _getViewPortSize() {
        const a = this._scheduler, t = a.$domHelpers, n = this._getViewPort();
        let o, r = n, d = window.scrollY + document.body.scrollTop, i = window.scrollX + document.body.scrollLeft;
        return n === a.$event_data ? (r = a.$event, d = 0, i = 0, o = t.getNodePosition(a.$event)) : o = t.getNodePosition(r), { left: o.x + i, top: o.y + d, width: o.width, height: o.height, bottom: o.y + o.height + d, right: o.x + o.width + i };
      }
    }
    class TooltipManager {
      constructor(a) {
        this._listeners = {}, this.tooltip = new Tooltip(a), this._scheduler = a, this._domEvents = a._createDomEventScope(), this._initDelayedFunctions();
      }
      destructor() {
        this.tooltip.hide(), this._domEvents.detachAll();
      }
      hideTooltip() {
        this.delayHide();
      }
      attach(a) {
        let t = document.body;
        const n = this._scheduler, o = n.$domHelpers;
        a.global || (t = n.$root);
        let r = null;
        const d = (i) => {
          const s = o.getTargetNode(i), _ = o.closest(s, a.selector);
          if (o.isChildOf(s, this.tooltip.getNode()))
            return;
          const l = () => {
            r = _, a.onmouseenter(i, _);
          };
          r ? _ && _ === r ? a.onmousemove(i, _) : (a.onmouseleave(i, r), r = null, _ && _ !== r && l()) : _ && l();
        };
        this.detach(a.selector), this._domEvents.attach(t, "mousemove", d), this._listeners[a.selector] = { node: t, handler: d };
      }
      detach(a) {
        const t = this._listeners[a];
        t && this._domEvents.detach(t.node, "mousemove", t.handler);
      }
      tooltipFor(a) {
        const t = (n) => {
          let o = n;
          return document.createEventObject && !document.createEvent && (o = document.createEventObject(n)), o;
        };
        this._initDelayedFunctions(), this.attach({ selector: a.selector, global: a.global, onmouseenter: (n, o) => {
          const r = a.html(n, o);
          r && this.delayShow(t(n), r);
        }, onmousemove: (n, o) => {
          const r = a.html(n, o);
          r ? this.delayShow(t(n), r) : (this.delayShow.$cancelTimeout(), this.delayHide());
        }, onmouseleave: () => {
          this.delayShow.$cancelTimeout(), this.delayHide();
        } });
      }
      _initDelayedFunctions() {
        const a = this._scheduler;
        this.delayShow && this.delayShow.$cancelTimeout(), this.delayHide && this.delayHide.$cancelTimeout(), this.tooltip.hide(), this.delayShow = utils.delay((t, n) => {
          a.callEvent("onBeforeTooltip", [t]) === !1 ? this.tooltip.hide() : (this.tooltip.setContent(n), this.tooltip.show(t));
        }, a.config.tooltip_timeout || 1), this.delayHide = utils.delay(() => {
          this.delayShow.$cancelTimeout(), this.tooltip.hide();
        }, a.config.tooltip_hide_timeout || 1);
      }
    }
    function tooltip(e) {
      e.config.tooltip_timeout = 30, e.config.tooltip_offset_y = 20, e.config.tooltip_offset_x = 10, e.config.tooltip_hide_timeout = 30;
      const a = new TooltipManager(e);
      e.ext.tooltips = a, e.attachEvent("onSchedulerReady", function() {
        a.tooltipFor({ selector: "[" + e.config.event_attribute + "]", html: (t) => {
          if (e._mobile && !e.config.touch_tooltip)
            return;
          const n = e._locate_event(t.target);
          if (e.getEvent(n)) {
            const o = e.getEvent(n);
            return e.templates.tooltip_text(o.start_date, o.end_date, o);
          }
          return null;
        }, global: !1 });
      }), e.attachEvent("onDestroy", function() {
        a.destructor();
      }), e.attachEvent("onLightbox", function() {
        a.hideTooltip();
      }), e.attachEvent("onBeforeDrag", function() {
        return a.hideTooltip(), !0;
      }), e.attachEvent("onEventDeleted", function() {
        return a.hideTooltip(), !0;
      });
    }
    function treetimeline(e) {
      var a;
      e.attachEvent("onTimelineCreated", function(t) {
        t.render == "tree" && (t.y_unit_original = t.y_unit, t.y_unit = e._getArrayToDisplay(t.y_unit_original), e.attachEvent("onOptionsLoadStart", function() {
          t.y_unit = e._getArrayToDisplay(t.y_unit_original);
        }), e.form_blocks[t.name] = { render: function(n) {
          return "<div class='dhx_section_timeline' style='overflow: hidden;'></div>";
        }, set_value: function(n, o, r, d) {
          var i = e._getArrayForSelect(e.matrix[d.type].y_unit_original, d.type);
          n.innerHTML = "";
          var s = document.createElement("select");
          n.appendChild(s);
          var _ = n.getElementsByTagName("select")[0];
          !_._dhx_onchange && d.onchange && (_.addEventListener("change", d.onchange), _._dhx_onchange = !0);
          for (var l = 0; l < i.length; l++) {
            var h = document.createElement("option");
            h.value = i[l].key, h.value == r[e.matrix[d.type].y_property] && (h.selected = !0), h.innerHTML = i[l].label, _.appendChild(h);
          }
        }, get_value: function(n, o, r) {
          return n.firstChild.value;
        }, focus: function(n) {
        } });
      }), e.attachEvent("onBeforeSectionRender", function(t, n, o) {
        var r, d, i, s, _, l, h = {};
        return t == "tree" && (s = "dhx_matrix_scell dhx_treetimeline", n.children ? (r = o.folder_dy || o.dy, o.folder_dy && !o.section_autoheight && (i = "height:" + o.folder_dy + "px;"), d = "dhx_row_folder", s += " folder", n.open ? s += " opened" : s += " closed", _ = "<div class='dhx_scell_expand'></div>", l = o.folder_events_available ? "dhx_data_table folder_events" : "dhx_data_table folder") : (r = o.dy, d = "dhx_row_item", s += " item", _ = "", l = "dhx_data_table"), o.columns && (s += " dhx_matrix_scell_columns"), h = { height: r, style_height: i, tr_className: d, td_className: s += e.templates[o.name + "_scaley_class"](n.key, n.label, n) ? " " + e.templates[o.name + "_scaley_class"](n.key, n.label, n) : "", td_content: o.columns && o.columns.length ? "<div class='dhx_scell_name'><div class='dhx_scell_level dhx_scell_level" + n.level + "'>" + _ + "</div>" + (e.templates[o.name + "_scale_label"](n.key, n.label, n) || n.label) + "</div>" : "<div class='dhx_scell_level" + n.level + "'>" + _ + "<div class='dhx_scell_name'>" + (e.templates[o.name + "_scale_label"](n.key, n.label, n) || n.label) + "</div></div>", table_className: l }), h;
      }), e.attachEvent("onBeforeEventChanged", function(t, n, o) {
        if (e._isRender("tree"))
          for (var r = e._get_event_sections ? e._get_event_sections(t) : [t[e.matrix[e._mode].y_property]], d = 0; d < r.length; d++) {
            var i = e.getSection(r[d]);
            if (i && i.children && !e.matrix[e._mode].folder_events_available)
              return o || (t[e.matrix[e._mode].y_property] = a), !1;
          }
        return !0;
      }), e.attachEvent("onBeforeDrag", function(t, n, o) {
        if (e._isRender("tree")) {
          var r, d = e._locate_cell_timeline(o);
          if (d && (r = e.matrix[e._mode].y_unit[d.y].key, e.matrix[e._mode].y_unit[d.y].children && !e.matrix[e._mode].folder_events_available))
            return !1;
          var i = e.getEvent(t), s = e.matrix[e._mode].y_property;
          a = i && i[s] ? i[s] : r;
        }
        return !0;
      }), e._getArrayToDisplay = function(t) {
        var n = [], o = function(r, d, i, s) {
          for (var _ = d || 0, l = 0; l < r.length; l++) {
            var h = r[l];
            h.level = _, h.$parent = i || null, h.children && h.key === void 0 && (h.key = e.uid()), s || n.push(h), h.children && o(h.children, _ + 1, h.key, s || !h.open);
          }
        };
        return o(t), n;
      }, e._getArrayForSelect = function(t, n) {
        var o = [], r = function(d) {
          for (var i = 0; i < d.length; i++)
            e.matrix[n].folder_events_available ? o.push(d[i]) : d[i].children || o.push(d[i]), d[i].children && r(d[i].children);
        };
        return r(t), o;
      }, e._toggleFolderDisplay = function(t, n, o) {
        var r = function(i, s, _, l) {
          for (var h = 0; h < s.length && (s[h].key != i && !l || !s[h].children || (s[h].open = _ !== void 0 ? _ : !s[h].open, l)); h++)
            s[h].children && r(i, s[h].children, _, l);
        }, d = e.getSection(t);
        n !== void 0 || o || (n = !d.open), e.callEvent("onBeforeFolderToggle", [d, n, o]) && (r(t, e.matrix[e._mode].y_unit_original, n, o), e.matrix[e._mode].y_unit = e._getArrayToDisplay(e.matrix[e._mode].y_unit_original), e.callEvent("onOptionsLoad", []), e.callEvent("onAfterFolderToggle", [d, n, o]));
      }, e.attachEvent("onCellClick", function(t, n, o, r, d) {
        e._isRender("tree") && (e.matrix[e._mode].folder_events_available || e.matrix[e._mode].y_unit[n] !== void 0 && e.matrix[e._mode].y_unit[n].children && e._toggleFolderDisplay(e.matrix[e._mode].y_unit[n].key));
      }), e.attachEvent("onYScaleClick", function(t, n, o) {
        e._isRender("tree") && n.children && e._toggleFolderDisplay(n.key);
      }), e.getSection = function(t) {
        if (e._isRender("tree")) {
          var n, o = function(r, d) {
            for (var i = 0; i < d.length; i++)
              d[i].key == r && (n = d[i]), d[i].children && o(r, d[i].children);
          };
          return o(t, e.matrix[e._mode].y_unit_original), n || null;
        }
      }, e.deleteSection = function(t) {
        if (e._isRender("tree")) {
          var n = !1, o = function(r, d) {
            for (var i = 0; i < d.length && (d[i].key == r && (d.splice(i, 1), n = !0), !n); i++)
              d[i].children && o(r, d[i].children);
          };
          return o(t, e.matrix[e._mode].y_unit_original), e.matrix[e._mode].y_unit = e._getArrayToDisplay(e.matrix[e._mode].y_unit_original), e.callEvent("onOptionsLoad", []), n;
        }
      }, e.deleteAllSections = function() {
        e._isRender("tree") && (e.matrix[e._mode].y_unit_original = [], e.matrix[e._mode].y_unit = e._getArrayToDisplay(e.matrix[e._mode].y_unit_original), e.callEvent("onOptionsLoad", []));
      }, e.addSection = function(t, n) {
        if (e._isRender("tree")) {
          var o = !1, r = function(d, i, s) {
            if (n)
              for (var _ = 0; _ < s.length && (s[_].key == i && s[_].children && (s[_].children.push(d), o = !0), !o); _++)
                s[_].children && r(d, i, s[_].children);
            else
              s.push(d), o = !0;
          };
          return r(t, n, e.matrix[e._mode].y_unit_original), e.matrix[e._mode].y_unit = e._getArrayToDisplay(e.matrix[e._mode].y_unit_original), e.callEvent("onOptionsLoad", []), o;
        }
      }, e.openAllSections = function() {
        e._isRender("tree") && e._toggleFolderDisplay(1, !0, !0);
      }, e.closeAllSections = function() {
        e._isRender("tree") && e._toggleFolderDisplay(1, !1, !0);
      }, e.openSection = function(t) {
        e._isRender("tree") && e._toggleFolderDisplay(t, !0);
      }, e.closeSection = function(t) {
        e._isRender("tree") && e._toggleFolderDisplay(t, !1);
      };
    }
    function units(e) {
      e._props = {}, e.createUnitsView = function(a, t, n, o, r, d, i) {
        function s(h) {
          return Math.round((e._correct_shift(+h, 1) - +e._min_date) / 864e5);
        }
        typeof a == "object" && (n = a.list, t = a.property, o = a.size || 0, r = a.step || 1, d = a.skip_incorrect, i = a.days || 1, a = a.name), e._props[a] = { map_to: t, options: n, step: r, position: 0, days: i }, o > e._props[a].options.length && (e._props[a]._original_size = o, o = 0), e._props[a].size = o, e._props[a].skip_incorrect = d || !1, e.date[a + "_start"] = e.date.day_start, e.templates[a + "_date"] = function(h, u) {
          return e._props[a].days > 1 ? e.templates.week_date(h, u) : e.templates.day_date(h);
        }, e._get_unit_index = function(h, u) {
          var m = h.position || 0, f = s(u), y = h.size || h.options.length;
          return f >= y && (f %= y), m + f;
        }, e.templates[a + "_scale_text"] = function(h, u, m) {
          return m.css ? "<span class='" + m.css + "'>" + u + "</span>" : u;
        }, e.templates[a + "_scale_date"] = function(h) {
          var u = e._props[a], m = u.options;
          if (!m.length)
            return "";
          var f = m[e._get_unit_index(u, h)], y = s(h), b = u.size || u.options.length, c = e.date.add(e.getState().min_date, Math.floor(y / b), "day");
          return e.templates[a + "_scale_text"](f.key, f.label, f, c);
        }, e.templates[a + "_second_scale_date"] = function(h) {
          return e.templates.week_scale_date(h);
        }, e.date["add_" + a] = function(h, u) {
          return e.date.add(h, u * e._props[a].days, "day");
        }, e.date["get_" + a + "_end"] = function(h) {
          return e.date.add(h, (e._props[a].size || e._props[a].options.length) * e._props[a].days, "day");
        }, e.attachEvent("onOptionsLoad", function() {
          for (var h = e._props[a], u = h.order = {}, m = h.options, f = 0; f < m.length; f++)
            u[m[f].key] = f;
          h._original_size && h.size === 0 && (h.size = h._original_size, delete h._original_size), h.size > m.length ? (h._original_size = h.size, h.position = 0, h.size = 0) : h.size = h._original_size || h.size, e._date && e._mode == a && e.setCurrentView(e._date, e._mode);
        }), e["mouse_" + a] = function(h) {
          var u = e._props[this._mode];
          if (u) {
            if (h = this._week_indexes_from_pos(h), this._drag_event || (this._drag_event = {}), this._drag_id && this._drag_mode && (this._drag_event._dhx_changed = !0), this._drag_mode && this._drag_mode == "new-size") {
              var m = e._get_event_sday(e._events[e._drag_id]);
              Math.floor(h.x / u.options.length) != Math.floor(m / u.options.length) && (h.x = m);
            }
            var f = u.size || u.options.length, y = h.x % f, b = Math.min(y + u.position, u.options.length - 1);
            h.section = (u.options[b] || {}).key, h.x = Math.floor(h.x / f);
            var c = this.getEvent(this._drag_id);
            this._update_unit_section({ view: u, event: c, pos: h });
          }
          return h.force_redraw = !0, h;
        };
        var _ = !1;
        function l() {
          _ && (e.xy.scale_height /= 2, _ = !1);
        }
        e[a + "_view"] = function(h) {
          var u = e._props[e._mode];
          h ? (u && u.days > 1 ? _ || (_ = e.xy.scale_height, e.xy.scale_height = 2 * e.xy.scale_height) : l(), e._reset_scale()) : l();
        }, e.callEvent("onOptionsLoad", []);
      }, e._update_unit_section = function(a) {
        var t = a.view, n = a.event, o = a.pos;
        n && (n[t.map_to] = o.section);
      }, e.scrollUnit = function(a) {
        var t = e._props[this._mode];
        t && (t.position = Math.min(Math.max(0, t.position + a), t.options.length - t.size), this.setCurrentView());
      }, function() {
        var a = function(f) {
          var y = e._props[e._mode];
          if (y && y.order && y.skip_incorrect) {
            for (var b = [], c = 0; c < f.length; c++)
              y.order[f[c][y.map_to]] !== void 0 && b.push(f[c]);
            f.splice(0, f.length), f.push.apply(f, b);
          }
          return f;
        }, t = e._pre_render_events_table;
        e._pre_render_events_table = function(f, y) {
          return f = a(f), t.apply(this, [f, y]);
        };
        var n = e._pre_render_events_line;
        e._pre_render_events_line = function(f, y) {
          return f = a(f), n.apply(this, [f, y]);
        };
        var o = function(f, y) {
          if (f && f.order[y[f.map_to]] === void 0) {
            var b = e, c = Math.floor((y.end_date - b._min_date) / 864e5);
            return f.options.length && (y[f.map_to] = f.options[Math.min(c + f.position, f.options.length - 1)].key), !0;
          }
        }, r = e.is_visible_events;
        e.is_visible_events = function(f) {
          var y = r.apply(this, arguments);
          if (y) {
            var b = e._props[this._mode];
            if (b && b.size) {
              var c = b.order[f[b.map_to]];
              if (c < b.position || c >= b.size + b.position)
                return !1;
            }
          }
          return y;
        };
        var d = e._process_ignores;
        e._process_ignores = function(f, y, b, c, g) {
          if (e._props[this._mode]) {
            this._ignores = {}, this._ignores_detected = 0;
            var v = e["ignore_" + this._mode];
            if (v) {
              var p = e._props && e._props[this._mode] ? e._props[this._mode].size || e._props[this._mode].options.length : 1;
              y /= p;
              for (var x = new Date(f), w = 0; w < y; w++) {
                if (v(x))
                  for (var k = (w + 1) * p, E = w * p; E < k; E++)
                    this._ignores_detected += 1, this._ignores[E] = !0, g && y++;
                x = e.date.add(x, c, b), e.date[b + "_start"] && (x = e.date[b + "_start"](x));
              }
            }
          } else
            d.call(this, f, y, b, c, g);
        };
        var i = e._reset_scale;
        e._reset_scale = function() {
          var f = e._props[this._mode];
          f && (f.size && f.position && f.size + f.position > f.options.length ? f.position = Math.max(0, f.options.length - f.size) : f.size || (f.position = 0));
          var y = i.apply(this, arguments);
          if (f) {
            this._max_date = this.date.add(this._min_date, f.days, "day");
            for (var b = this._els.dhx_cal_data[0].childNodes, c = 0; c < b.length; c++)
              b[c].classList.remove("dhx_scale_holder_now");
            var g = this._currentDate();
            if (g.valueOf() >= this._min_date && g.valueOf() < this._max_date) {
              var v = Math.floor((g - e._min_date) / 864e5), p = f.size || f.options.length, x = v * p, w = x + p;
              for (c = x; c < w; c++)
                b[c] && b[c].classList.add("dhx_scale_holder_now");
            }
            if (f.size && f.size < f.options.length) {
              var k = this._els.dhx_cal_header[0], E = document.createElement("div");
              f.position && (this._waiAria.headerButtonsAttributes(E, ""), e.config.rtl ? (E.className = "dhx_cal_next_button", E.style.cssText = "left:auto;margin-top:1px;right:0px;position:absolute;") : (E.className = "dhx_cal_prev_button", E.style.cssText = "left:1px;margin-top:1px;position:absolute;"), k.firstChild.appendChild(E), E.addEventListener("click", function(D) {
                e.scrollUnit(-1 * f.step), D.preventDefault();
              })), f.position + f.size < f.options.length && (this._waiAria.headerButtonsAttributes(E, ""), E = document.createElement("div"), e.config.rtl ? (E.className = "dhx_cal_prev_button", E.style.cssText = "left:1px;margin-top:1px;position:absolute;") : (E.className = "dhx_cal_next_button", E.style.cssText = "left:auto;margin-top:1px;right:0px;position:absolute;"), k.lastChild.appendChild(E), E.addEventListener("click", function() {
                e.scrollUnit(f.step);
              }));
            }
          }
          return y;
        };
        var s = e._get_view_end;
        e._get_view_end = function() {
          var f = e._props[this._mode];
          if (f && f.days > 1) {
            var y = this._get_timeunit_start();
            return e.date.add(y, f.days, "day");
          }
          return s.apply(this, arguments);
        };
        var _ = e._render_x_header;
        e._render_x_header = function(f, y, b, c) {
          var g = e._props[this._mode];
          if (!g || g.days <= 1)
            return _.apply(this, arguments);
          if (g.days > 1) {
            var v = c.querySelector(".dhx_second_cal_header");
            v || ((v = document.createElement("div")).className = "dhx_second_cal_header", c.appendChild(v));
            var p = e.xy.scale_height;
            e.xy.scale_height = Math.ceil(p / 2), _.call(this, f, y, b, v, Math.ceil(e.xy.scale_height));
            var x = g.size || g.options.length;
            if ((f + 1) % x == 0) {
              var w = document.createElement("div");
              w.className = "dhx_scale_bar dhx_second_scale_bar";
              var k = this.date.add(this._min_date, Math.floor(f / x), "day");
              this.templates[this._mode + "_second_scalex_class"] && (w.className += " " + this.templates[this._mode + "_second_scalex_class"](new Date(k)));
              var E, D = this._cols[f] * x;
              E = x > 1 && this.config.rtl ? this._colsS[f - (x - 1)] - this.xy.scroll_width - 2 : x > 1 ? this._colsS[f - (x - 1)] - this.xy.scale_width - 2 : y, this.set_xy(w, D, this.xy.scale_height, E, 0), w.innerHTML = this.templates[this._mode + "_second_scale_date"](new Date(k), this._mode), v.appendChild(w);
            }
            e.xy.scale_height = p;
          }
        };
        var l = e._get_event_sday;
        e._get_event_sday = function(f) {
          var y = e._props[this._mode];
          return y ? y.days <= 1 ? (o(y, f), this._get_section_sday(f[y.map_to])) : Math.floor((f.end_date.valueOf() - 1 - 60 * f.end_date.getTimezoneOffset() * 1e3 - (e._min_date.valueOf() - 60 * e._min_date.getTimezoneOffset() * 1e3)) / 864e5) * (y.size || y.options.length) + y.order[f[y.map_to]] - y.position : l.call(this, f);
        }, e._get_section_sday = function(f) {
          var y = e._props[this._mode];
          return y.order[f] - y.position;
        };
        var h = e.locate_holder_day;
        e.locate_holder_day = function(f, y, b) {
          var c, g = e._props[this._mode];
          return g ? (b ? o(g, b) : (b = { start_date: f, end_date: f }, c = 0), g.days <= 1 ? 1 * (c === void 0 ? g.order[b[g.map_to]] : c) + (y ? 1 : 0) - g.position : Math.floor((b.start_date.valueOf() - e._min_date.valueOf()) / 864e5) * (g.size || g.options.length) + 1 * (c === void 0 ? g.order[b[g.map_to]] : c) + (y ? 1 : 0) - g.position) : h.apply(this, arguments);
        };
        var u = e._time_order;
        e._time_order = function(f) {
          var y = e._props[this._mode];
          y ? f.sort(function(b, c) {
            return y.order[b[y.map_to]] > y.order[c[y.map_to]] ? 1 : -1;
          }) : u.apply(this, arguments);
        };
        var m = e._pre_render_events_table;
        e._pre_render_events_table = function(f, y) {
          var b = e._props[this._mode];
          if (b && b.days > 1) {
            for (var c, g = {}, v = 0; v < f.length; v++) {
              var p = f[v];
              if (e.isOneDayEvent(f[v]))
                g[k = +e.date.date_part(new Date(p.start_date))] || (g[k] = []), g[k].push(p);
              else {
                var x = new Date(Math.min(+p.end_date, +this._max_date)), w = new Date(Math.max(+p.start_date, +this._min_date));
                for (w = e.date.day_start(w), f.splice(v, 1), v--; +w < +x; ) {
                  var k, E = this._copy_event(p);
                  E.start_date = w, E.end_date = M(E.start_date), w = e.date.add(w, 1, "day"), g[k = +e.date.date_part(new Date(w))] || (g[k] = []), g[k].push(E);
                }
              }
            }
            f = [];
            for (var v in g) {
              var D = m.apply(this, [g[v], y]), S = this._colsS.heights;
              (!c || S[0] > c[0]) && (c = S.slice()), f.push.apply(f, D);
            }
            var N = this._colsS.heights;
            for (N.splice(0, N.length), N.push.apply(N, c), v = 0; v < f.length; v++)
              if (this._ignores[f[v]._sday])
                f.splice(v, 1), v--;
              else {
                var A = f[v];
                A._first_chunk = A._last_chunk = !1, this.getEvent(A.id)._sorder = A._sorder;
              }
            f.sort(function(C, T) {
              return C.start_date.valueOf() == T.start_date.valueOf() ? C.id > T.id ? 1 : -1 : C.start_date > T.start_date ? 1 : -1;
            });
          } else
            f = m.apply(this, [f, y]);
          function M(C) {
            var T = e.date.add(C, 1, "day");
            return T = e.date.date_part(T);
          }
          return f;
        }, e.attachEvent("onEventAdded", function(f, y) {
          if (this._loading)
            return !0;
          for (var b in e._props) {
            var c = e._props[b];
            y[c.map_to] === void 0 && c.options[0] && (y[c.map_to] = c.options[0].key);
          }
          return !0;
        }), e.attachEvent("onEventCreated", function(f, y) {
          var b = e._props[this._mode];
          if (b && y) {
            var c = this.getEvent(f);
            o(b, c);
            var g = this._mouse_coords(y);
            this._update_unit_section({ view: b, event: c, pos: g }), this.event_updated(c);
          }
          return !0;
        });
      }();
    }
    function url(e) {
      e._get_url_nav = function() {
        for (var a = {}, t = (document.location.hash || "").replace("#", "").split(","), n = 0; n < t.length; n++) {
          var o = t[n].split("=");
          o.length == 2 && (a[o[0]] = o[1]);
        }
        return a;
      }, e.attachEvent("onTemplatesReady", function() {
        var a = !0, t = e.date.str_to_date("%Y-%m-%d"), n = e.date.date_to_str("%Y-%m-%d"), o = e._get_url_nav().event || null;
        function r(d) {
          if (e.$destroyed)
            return !0;
          o = d, e.getEvent(d) && e.showEvent(d);
        }
        e.attachEvent("onAfterEventDisplay", function(d) {
          return o = null, !0;
        }), e.attachEvent("onBeforeViewChange", function(d, i, s, _) {
          if (a) {
            a = !1;
            var l = e._get_url_nav();
            if (l.event)
              try {
                if (e.getEvent(l.event))
                  return setTimeout(function() {
                    r(l.event);
                  }), !1;
                var h = e.attachEvent("onXLE", function() {
                  setTimeout(function() {
                    r(l.event);
                  }), e.detachEvent(h);
                });
              } catch {
              }
            if (l.date || l.mode) {
              try {
                this.setCurrentView(l.date ? t(l.date) : null, l.mode || null);
              } catch {
                this.setCurrentView(l.date ? t(l.date) : null, s);
              }
              return !1;
            }
          }
          var u = ["date=" + n(_ || i), "mode=" + (s || d)];
          o && u.push("event=" + o);
          var m = "#" + u.join(",");
          return document.location.hash = m, !0;
        });
      });
    }
    function week_agenda(e) {
      var a;
      e._wa = {}, e.xy.week_agenda_scale_height = 20, e.templates.week_agenda_event_text = function(t, n, o, r) {
        return e.templates.event_date(t) + " " + o.text;
      }, e.date.week_agenda_start = e.date.week_start, e.date.week_agenda_end = function(t) {
        return e.date.add(t, 7, "day");
      }, e.date.add_week_agenda = function(t, n) {
        return e.date.add(t, 7 * n, "day");
      }, e.attachEvent("onSchedulerReady", function() {
        var t = e.templates;
        t.week_agenda_date || (t.week_agenda_date = t.week_date);
      }), a = e.date.date_to_str("%l, %F %d"), e.templates.week_agenda_scale_date = function(t) {
        return a(t);
      }, e.attachEvent("onTemplatesReady", function() {
        var t = e.render_data;
        function n(o) {
          return `<div class='dhx_wa_day_cont'>
	<div class='dhx_wa_scale_bar'></div>
	<div class='dhx_wa_day_data' data-day='${o}'></div>
</div>`;
        }
        e.render_data = function(o) {
          if (this._mode != "week_agenda")
            return t.apply(this, arguments);
          e.week_agenda_view(!0);
        }, e.week_agenda_view = function(o) {
          e._min_date = e.date.week_start(e._date), e._max_date = e.date.add(e._min_date, 1, "week"), e.set_sizes(), o ? (e._table_view = e._allow_dnd = !0, e.$container.querySelector(".dhx_cal_header").style.display = "none", e._els.dhx_cal_date[0].innerHTML = "", function() {
            e._els.dhx_cal_data[0].innerHTML = "", e._rendered = [];
            var r = `<div class="dhx_week_agenda_wrapper">
<div class='dhx_wa_column'>
	${n(0)}
	${n(1)}
	${n(2)}
</div>
<div class='dhx_wa_column'>
	${n(3)}
	${n(4)}
	${n(5)}
	${n(6)}
</div>
</div>`, d = e._getNavDateElement();
            d && (d.innerHTML = e.templates[e._mode + "_date"](e._min_date, e._max_date, e._mode)), e._els.dhx_cal_data[0].innerHTML = r;
            const i = e.$container.querySelectorAll(".dhx_wa_day_cont");
            e._wa._selected_divs = [];
            for (var s = e.get_visible_events(), _ = e.date.week_start(e._date), l = e.date.add(_, 1, "day"), h = 0; h < 7; h++) {
              i[h]._date = _, i[h].setAttribute("data-date", e.templates.format_date(_)), e._waiAria.weekAgendaDayCell(i[h], _);
              var u = i[h].querySelector(".dhx_wa_scale_bar"), m = i[h].querySelector(".dhx_wa_day_data");
              u.innerHTML = e.templates.week_agenda_scale_date(_);
              for (var f = [], y = 0; y < s.length; y++) {
                var b = s[y];
                b.start_date < l && b.end_date > _ && f.push(b);
              }
              f.sort(function(w, k) {
                return w.start_date.valueOf() == k.start_date.valueOf() ? w.id > k.id ? 1 : -1 : w.start_date > k.start_date ? 1 : -1;
              });
              for (var c = 0; c < f.length; c++) {
                var g = f[c], v = document.createElement("div");
                e._rendered.push(v);
                var p = e.templates.event_class(g.start_date, g.end_date, g);
                v.classList.add("dhx_wa_ev_body"), p && v.classList.add(p), e.config.rtl && v.classList.add("dhx_wa_ev_body_rtl"), g._text_style && (v.style.cssText = g._text_style), g.color && v.style.setProperty("--dhx-scheduler-event-background", g.color), g.textColor && v.style.setProperty("--dhx-scheduler-event-color", g.textColor), e._select_id && g.id == e._select_id && (e.config.week_agenda_select || e.config.week_agenda_select === void 0) && (v.classList.add("dhx_cal_event_selected"), e._wa._selected_divs.push(v));
                var x = "";
                g._timed || (x = "middle", g.start_date.valueOf() >= _.valueOf() && g.start_date.valueOf() <= l.valueOf() && (x = "start"), g.end_date.valueOf() >= _.valueOf() && g.end_date.valueOf() <= l.valueOf() && (x = "end")), v.innerHTML = e.templates.week_agenda_event_text(g.start_date, g.end_date, g, _, x), v.setAttribute("event_id", g.id), v.setAttribute(e.config.event_attribute, g.id), e._waiAria.weekAgendaEvent(v, g), m.appendChild(v);
              }
              _ = e.date.add(_, 1, "day"), l = e.date.add(l, 1, "day");
            }
          }()) : (e._table_view = e._allow_dnd = !1, e.$container.querySelector(".dhx_cal_header").style.display = "");
        }, e.mouse_week_agenda = function(o) {
          var r = o.ev;
          const d = o.ev.target.closest(".dhx_wa_day_cont");
          let i;
          if (d && (i = d._date), !i)
            return o;
          o.x = 0;
          var s = i.valueOf() - e._min_date.valueOf();
          if (o.y = Math.ceil(s / 6e4 / this.config.time_step), this._drag_mode == "move" && this._drag_pos && this._is_pos_changed(this._drag_pos, o)) {
            var _;
            this._drag_event._dhx_changed = !0, this._select_id = this._drag_id;
            for (var l = 0; l < e._rendered.length; l++)
              e._drag_id == this._rendered[l].getAttribute(this.config.event_attribute) && (_ = this._rendered[l]);
            if (!e._wa._dnd) {
              var h = _.cloneNode(!0);
              this._wa._dnd = h, h.className = _.className, h.id = "dhx_wa_dnd", h.className += " dhx_wa_dnd", document.body.appendChild(h);
            }
            var u = document.getElementById("dhx_wa_dnd");
            u.style.top = (r.pageY || r.clientY) + 20 + "px", u.style.left = (r.pageX || r.clientX) + 20 + "px";
          }
          return o;
        }, e.attachEvent("onBeforeEventChanged", function(o, r, d) {
          if (this._mode == "week_agenda" && this._drag_mode == "move") {
            var i = document.getElementById("dhx_wa_dnd");
            i.parentNode.removeChild(i), e._wa._dnd = !1;
          }
          return !0;
        }), e.attachEvent("onEventSave", function(o, r, d) {
          return d && this._mode == "week_agenda" && (this._select_id = o), !0;
        }), e._wa._selected_divs = [], e.attachEvent("onClick", function(o, r) {
          if (this._mode == "week_agenda" && (e.config.week_agenda_select || e.config.week_agenda_select === void 0)) {
            if (e._wa._selected_divs)
              for (var d = 0; d < this._wa._selected_divs.length; d++) {
                var i = this._wa._selected_divs[d];
                i.className = i.className.replace(/ dhx_cal_event_selected/, "");
              }
            return this.for_rendered(o, function(s) {
              s.className += " dhx_cal_event_selected", e._wa._selected_divs.push(s);
            }), e._select_id = o, !1;
          }
          return !0;
        });
      });
    }
    function wp(e) {
      e.attachEvent("onLightBox", function() {
        if (this._cover)
          try {
            this._cover.style.height = this.expanded ? "100%" : (document.body.parentNode || document.body).scrollHeight + "px";
          } catch {
          }
      }), e.form_blocks.select.set_value = function(a, t, n) {
        t !== void 0 && t !== "" || (t = (a.firstChild.options[0] || {}).value), a.firstChild.value = t || "";
      };
    }
    function year_view(e) {
      e.templates.year_date = function(i) {
        return e.date.date_to_str(e.locale.labels.year_tab + " %Y")(i);
      }, e.templates.year_month = e.date.date_to_str("%F"), e.templates.year_scale_date = e.date.date_to_str("%D"), e.templates.year_tooltip = function(i, s, _) {
        return _.text;
      };
      const a = function() {
        return e._mode == "year";
      }, t = function(i) {
        var s = e.$domHelpers.closest(i, "[data-cell-date]");
        return s && s.hasAttribute("data-cell-date") ? e.templates.parse_date(s.getAttribute("data-cell-date")) : null;
      };
      e.dblclick_dhx_month_head = function(i) {
        if (a()) {
          const s = i.target;
          if (e.$domHelpers.closest(s, ".dhx_before") || e.$domHelpers.closest(s, ".dhx_after"))
            return !1;
          const _ = t(s);
          if (_) {
            const l = _, h = this.date.add(l, 1, "day");
            !this.config.readonly && this.config.dblclick_create && this.addEventNow(l.valueOf(), h.valueOf(), i);
          }
        }
      }, e.attachEvent("onEventIdChange", function() {
        a() && this.year_view(!0);
      });
      var n = e.render_data;
      e.render_data = function(i) {
        if (!a())
          return n.apply(this, arguments);
        for (var s = 0; s < i.length; s++)
          this._year_render_event(i[s]);
      };
      var o = e.clear_view;
      e.clear_view = function() {
        if (!a())
          return o.apply(this, arguments);
        var i = e._year_marked_cells;
        for (var s in i)
          i.hasOwnProperty(s) && i[s].classList.remove("dhx_year_event", "dhx_cal_datepicker_event");
        e._year_marked_cells = {};
      }, e._hideToolTip = function() {
        this._tooltip && (this._tooltip.style.display = "none", this._tooltip.date = new Date(9999, 1, 1));
      }, e._showToolTip = function(i, s, _, l) {
        if (this._tooltip) {
          if (this._tooltip.date.valueOf() == i.valueOf())
            return;
          this._tooltip.innerHTML = "";
        } else {
          var h = this._tooltip = document.createElement("div");
          h.className = "dhx_year_tooltip", this.config.rtl && (h.className += " dhx_tooltip_rtl"), document.body.appendChild(h), h.addEventListener("click", e._click.dhx_cal_data), h.addEventListener("click", function(g) {
            if (g.target.closest(`[${e.config.event_attribute}]`)) {
              const v = g.target.closest(`[${e.config.event_attribute}]`).getAttribute(e.config.event_attribute);
              e.showLightbox(v);
            }
          });
        }
        for (var u = this.getEvents(i, this.date.add(i, 1, "day")), m = "", f = 0; f < u.length; f++) {
          var y = u[f];
          if (this.filter_event(y.id, y)) {
            var b = y.color ? "--dhx-scheduler-event-background:" + y.color + ";" : "", c = y.textColor ? "--dhx-scheduler-event-color:" + y.textColor + ";" : "";
            m += "<div class='dhx_tooltip_line' style='" + b + c + "' event_id='" + u[f].id + "' " + this.config.event_attribute + "='" + u[f].id + "'>", m += "<div class='dhx_tooltip_date' style='" + b + c + "'>" + (u[f]._timed ? this.templates.event_date(u[f].start_date) : "") + "</div>", m += "<div class='dhx_event_icon icon_details'>&nbsp;</div>", m += this.templates.year_tooltip(u[f].start_date, u[f].end_date, u[f]) + "</div>";
          }
        }
        this._tooltip.style.display = "", this._tooltip.style.top = "0px", document.body.offsetWidth - s.left - this._tooltip.offsetWidth < 0 ? this._tooltip.style.left = s.left - this._tooltip.offsetWidth + "px" : this._tooltip.style.left = s.left + l.offsetWidth + "px", this._tooltip.date = i, this._tooltip.innerHTML = m, document.body.offsetHeight - s.top - this._tooltip.offsetHeight < 0 ? this._tooltip.style.top = s.top - this._tooltip.offsetHeight + l.offsetHeight + "px" : this._tooltip.style.top = s.top + "px";
      }, e._year_view_tooltip_handler = function(i) {
        if (a()) {
          var s = i.target || i.srcElement;
          s.tagName.toLowerCase() == "a" && (s = s.parentNode), e._getClassName(s).indexOf("dhx_year_event") != -1 ? e._showToolTip(e.templates.parse_date(s.getAttribute("data-year-date")), e.$domHelpers.getOffset(s), i, s) : e._hideToolTip();
        }
      }, e._init_year_tooltip = function() {
        e._detachDomEvent(e._els.dhx_cal_data[0], "mouseover", e._year_view_tooltip_handler), e.event(e._els.dhx_cal_data[0], "mouseover", e._year_view_tooltip_handler);
      }, e._get_year_cell = function(i) {
        for (var s = e.templates.format_date(i), _ = this.$root.querySelectorAll(`.dhx_cal_data .dhx_cal_datepicker_date[data-cell-date="${s}"]`), l = 0; l < _.length; l++)
          if (!e.$domHelpers.closest(_[l], ".dhx_after, .dhx_before"))
            return _[l];
        return null;
      }, e._year_marked_cells = {}, e._mark_year_date = function(i, s) {
        var _ = e.templates.format_date(i), l = this._get_year_cell(i);
        if (l) {
          var h = this.templates.event_class(s.start_date, s.end_date, s);
          e._year_marked_cells[_] || (l.classList.add("dhx_year_event", "dhx_cal_datepicker_event"), l.setAttribute("data-year-date", _), l.setAttribute("date", _), e._year_marked_cells[_] = l), h && l.classList.add(h);
        }
      }, e._unmark_year_date = function(i) {
        var s = this._get_year_cell(i);
        s && s.classList.remove("dhx_year_event", "dhx_cal_datepicker_event");
      }, e._year_render_event = function(i) {
        var s = i.start_date;
        for (s = s.valueOf() < this._min_date.valueOf() ? this._min_date : this.date.date_part(new Date(s)); s < i.end_date; )
          if (this._mark_year_date(s, i), (s = this.date.add(s, 1, "day")).valueOf() >= this._max_date.valueOf())
            return;
      }, e.year_view = function(i) {
        if (e.set_sizes(), e._table_view = i, !this._load_mode || !this._load())
          if (i) {
            if (e._init_year_tooltip(), e._reset_year_scale(), e._load_mode && e._load())
              return void (e._render_wait = !0);
            e.render_view_data();
          } else
            e._hideToolTip();
      }, e._reset_year_scale = function() {
        this._cols = [], this._colsS = {};
        var i = [], s = this._els.dhx_cal_data[0], _ = this.config;
        s.scrollTop = 0, s.innerHTML = "", Math.floor((parseInt(s.style.height) - e.xy.year_top) / _.year_y);
        var l = document.createElement("div"), h = this.date.week_start(e._currentDate());
        this._process_ignores(h, 7, "day", 1);
        for (var u = 0; u < 7; u++)
          this._ignores && this._ignores[u] || (this._cols[u] = "var(--dhx-scheduler-datepicker-cell-size)", this._render_x_header(u, 0, h, l)), h = this.date.add(h, 1, "day");
        for (l.lastChild.className += " dhx_scale_bar_last", u = 0; u < l.childNodes.length; u++)
          this._waiAria.yearHeadCell(l.childNodes[u]);
        var m = this.date[this._mode + "_start"](this.date.copy(this._date)), f = m, y = null;
        const b = document.createElement("div");
        for (b.classList.add("dhx_year_wrapper"), u = 0; u < _.year_y; u++)
          for (var c = 0; c < _.year_x; c++) {
            (y = document.createElement("div")).className = "dhx_year_box", y.setAttribute("date", this._helpers.formatDate(m)), y.setAttribute("data-month-date", this._helpers.formatDate(m)), y.innerHTML = "<div class='dhx_year_month'></div><div class='dhx_year_grid'><div class='dhx_year_week'>" + l.innerHTML + "</div><div class='dhx_year_body'></div></div>";
            var g = y.querySelector(".dhx_year_month"), v = y.querySelector(".dhx_year_grid"), p = y.querySelector(".dhx_year_body"), x = e.uid();
            this._waiAria.yearHeader(g, x), this._waiAria.yearGrid(v, x), g.innerHTML = this.templates.year_month(m);
            var w = this.date.week_start(m);
            this._reset_month_scale(p, m, w, 6);
            for (var k = p.querySelectorAll("td"), E = 0; E < k.length; E++)
              this._waiAria.yearDayCell(k[E]);
            b.appendChild(y), i[u * _.year_x + c] = (m.getDay() - (this.config.start_on_monday ? 1 : 0) + 7) % 7, m = this.date.add(m, 1, "month");
          }
        s.appendChild(b);
        var D = this._getNavDateElement();
        D && (D.innerHTML = this.templates[this._mode + "_date"](f, m, this._mode)), this.week_starts = i, i._month = f.getMonth(), this._min_date = f, this._max_date = m;
      }, e._reset_year_scale = function() {
        var i = this._els.dhx_cal_data[0];
        i.scrollTop = 0, i.innerHTML = "";
        let s = this.date.year_start(new Date(this._date));
        this._min_date = this.date.week_start(new Date(s));
        const _ = document.createElement("div");
        _.classList.add("dhx_year_wrapper");
        let l = s;
        for (let m = 0; m < 12; m++) {
          let f = document.createElement("div");
          f.className = "dhx_year_box", f.setAttribute("date", this._helpers.formatDate(l)), f.setAttribute("data-month-date", this._helpers.formatDate(l)), f.innerHTML = `<div class='dhx_year_month'>${this.templates.year_month(l)}</div>
			<div class='dhx_year_grid'></div>`;
          const y = f.querySelector(".dhx_year_grid"), b = e._createDatePicker(null, { date: l, minWeeks: 6 });
          b._renderDayGrid(y), b.destructor(), _.appendChild(f), l = this.date.add(l, 1, "month");
        }
        i.appendChild(_);
        let h = this.date.add(s, 1, "year");
        h.valueOf() != this.date.week_start(new Date(h)).valueOf() && (h = this.date.week_start(new Date(h)), h = this.date.add(h, 1, "week")), this._max_date = h;
        var u = this._getNavDateElement();
        u && (u.innerHTML = this.templates[this._mode + "_date"](s, h, this._mode));
      };
      var r = e.getActionData;
      e.getActionData = function(i) {
        return a() ? { date: t(i.target), section: null } : r.apply(e, arguments);
      };
      var d = e._locate_event;
      e._locate_event = function(i) {
        var s = d.apply(e, arguments);
        if (!s) {
          var _ = t(i);
          if (!_)
            return null;
          var l = e.getEvents(_, e.date.add(_, 1, "day"));
          if (!l.length)
            return null;
          s = l[0].id;
        }
        return s;
      }, e.attachEvent("onDestroy", function() {
        e._hideToolTip();
      });
    }
    function export_api(e) {
      (function() {
        function a(n, o) {
          for (var r in o)
            n[r] || (n[r] = o[r]);
          return n;
        }
        function t(n, o) {
          var r = {};
          return (n = o._els[n]) && n[0] ? (r.x = n[0].scrollWidth, r.y = n[0].scrollHeight) : (r.x = 0, r.y = 0), r;
        }
        window.dhtmlxAjax || (window.dhtmlxAjax = { post: function(n, o, r) {
          return window.dhx4.ajax.post(n, o, r);
        }, get: function(n, o) {
          return window.ajax.get(n, o);
        } }), function(n) {
          function o() {
            var r = n.getState().mode;
            return n.matrix && n.matrix[r] ? n.matrix[r] : null;
          }
          n.exportToPDF = function(r) {
            (r = a(r || {}, { name: "calendar.pdf", format: "A4", orientation: "landscape", dpi: 96, zoom: 1, rtl: n.config.rtl })).html = this._export_html(r), r.mode = this.getState().mode, this._send_to_export(r, "pdf");
          }, n.exportToPNG = function(r) {
            (r = a(r || {}, { name: "calendar.png", format: "A4", orientation: "landscape", dpi: 96, zoom: 1, rtl: n.config.rtl })).html = this._export_html(r), r.mode = this.getState().mode, this._send_to_export(r, "png");
          }, n.exportToICal = function(r) {
            r = a(r || {}, { name: "calendar.ical", data: this._serialize_plain(null, r) }), this._send_to_export(r, "ical");
          }, n.exportToExcel = function(r) {
            r = a(r || {}, { name: "calendar.xlsx", title: "Events", data: this._serialize_plain(this.templates.xml_format, r), columns: this._serialize_columns() }), this._send_to_export(r, "excel");
          }, n._ajax_to_export = function(r, d, i) {
            delete r.callback;
            var s = r.server || "https://export.dhtmlx.com/scheduler";
            window.dhtmlxAjax.post(s, "type=" + d + "&store=1&data=" + encodeURIComponent(JSON.stringify(r)), function(_) {
              var l = null;
              if (!(_.xmlDoc.status > 400))
                try {
                  l = JSON.parse(_.xmlDoc.responseText);
                } catch {
                }
              i(l);
            });
          }, n._plain_export_copy = function(r, d) {
            var i = {};
            for (var s in r)
              i[s] = r[s];
            return i.start_date = d(i.start_date), i.end_date = d(i.end_date), i.$text = this.templates.event_text(r.start_date, r.end_date, r), i;
          }, n._serialize_plain = function(r, d) {
            var i;
            r = r || n.date.date_to_str("%Y%m%dT%H%i%s", !0), i = d && d.start && d.end ? n.getEvents(d.start, d.end) : n.getEvents();
            for (var s = [], _ = 0; _ < i.length; _++)
              s[_] = this._plain_export_copy(i[_], r);
            return s;
          }, n._serialize_columns = function() {
            return [{ id: "start_date", header: "Start Date", width: 30 }, { id: "end_date", header: "End Date", width: 30 }, { id: "$text", header: "Text", width: 100 }];
          }, n._send_to_export = function(r, d) {
            if (r.version || (r.version = n.version), r.skin || (r.skin = n.skin), r.callback)
              return n._ajax_to_export(r, d, r.callback);
            var i = this._create_hidden_form();
            i.firstChild.action = r.server || "https://export.dhtmlx.com/scheduler", i.firstChild.childNodes[0].value = JSON.stringify(r), i.firstChild.childNodes[1].value = d, i.firstChild.submit();
          }, n._create_hidden_form = function() {
            if (!this._hidden_export_form) {
              var r = this._hidden_export_form = document.createElement("div");
              r.style.display = "none", r.innerHTML = "<form method='POST' target='_blank'><input type='text' name='data'><input type='hidden' name='type' value=''></form>", document.body.appendChild(r);
            }
            return this._hidden_export_form;
          }, n._get_export_size = function(r, d, i, s, _, l, h) {
            s = parseInt(s) / 25.4 || 4;
            var u = { A5: { x: 148, y: 210 }, A4: { x: 210, y: 297 }, A3: { x: 297, y: 420 }, A2: { x: 420, y: 594 }, A1: { x: 594, y: 841 }, A0: { x: 841, y: 1189 } }, m = t("dhx_cal_data", this).x, f = { y: t("dhx_cal_data", this).y + t("dhx_cal_header", this).y + t("dhx_multi_day", this).y };
            return f.x = r === "full" ? m : Math.floor((d === "landscape" ? u[r].y : u[r].x) * s), h && (f.x *= parseFloat(h.x) || 1, f.y *= parseFloat(h.y) || 1), f;
          }, n._export_html = function(r) {
            var d = function() {
              var _ = void 0, l = void 0, h = o();
              return h && (l = h.scrollable, _ = h.smart_rendering), { nav_height: n.xy.nav_height, scroll_width: n.xy.scroll_width, style_width: n._obj.style.width, style_height: n._obj.style.height, timeline_scrollable: l, timeline_smart_rendering: _ };
            }(), i = n._get_export_size(r.format, r.orientation, r.zoom, r.dpi, r.header, r.footer, r.scales), s = "";
            try {
              ((function(_, l) {
                n._obj.style.width = _.x + "px", n._obj.style.height = _.y + "px", n.xy.nav_height = 0, n.xy.scroll_width = 0;
                var h = o();
                (l.timeline_scrollable || l.timeline_smart_rendering) && (h.scrollable = !1, h.smart_rendering = !1);
              }))(i, d), n.setCurrentView(), s = n._obj.innerHTML;
            } catch (_) {
              console.error(_);
            } finally {
              ((function(_) {
                n.xy.scroll_width = _.scroll_width, n.xy.nav_height = _.nav_height, n._obj.style.width = _.style_width, n._obj.style.height = _.style_height;
                var l = o();
                (_.timeline_scrollable || _.timeline_smart_rendering) && (l.scrollable = _.timeline_scrollable, l.smart_rendering = _.timeline_smart_rendering);
              }))(d), n.setCurrentView();
            }
            return s;
          };
        }(e);
      })();
    }
    const allExtensions = { active_links, agenda_legacy, agenda_view, all_timed, collision, container_autoresize, cookie, daytimeline, drag_between, editors, expand, export_api, grid_view, html_templates, key_nav, layer, legacy, limit, map_view, minical, monthheight, multisection, multiselect, multisource, mvc, outerdrag, pdf, quick_info, readonly, recurring, serialize, timeline, tooltip, treetimeline, units, url, week_agenda, wp, year_view }, factory = new SchedulerFactory(allExtensions), scheduler = factory.getSchedulerInstance(), Scheduler$1 = factory;
    window.scheduler = scheduler, window.Scheduler = Scheduler$1, window.$dhx || (window.$dhx = {}), window.$dhx.scheduler = scheduler, window.$dhx.Scheduler = Scheduler$1;

    /* src\Scheduler.svelte generated by Svelte v3.59.2 */

    const { console: console_1 } = globals;
    const file = "src\\Scheduler.svelte";

    function create_fragment$1(ctx) {
    	let div;

    	const block = {
    		c: function create() {
    			div = element("div");
    			set_style(div, "width", "100%");
    			set_style(div, "height", "100vh");
    			add_location(div, file, 25, 0, 729);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			/*div_binding*/ ctx[3](div);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			/*div_binding*/ ctx[3](null);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Scheduler', slots, []);
    	let { data } = $$props;
    	let scheduler;
    	let container;

    	onMount(() => {
    		$$invalidate(2, scheduler = Scheduler$1.getSchedulerInstance());
    		$$invalidate(2, scheduler.skin = "material", scheduler);
    		scheduler.init(container, new Date(2023, 9, 6), "week");

    		scheduler.createDataProcessor((entity, action, data, id) => {
    			scheduler.message(`${entity}-${action} -> id=${id}`);
    			console.log(`${entity}-${action}`, data);
    		});

    		return () => scheduler.destructor();
    	});

    	$$self.$$.on_mount.push(function () {
    		if (data === undefined && !('data' in $$props || $$self.$$.bound[$$self.$$.props['data']])) {
    			console_1.warn("<Scheduler> was created without expected prop 'data'");
    		}
    	});

    	const writable_props = ['data'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<Scheduler> was created with unknown prop '${key}'`);
    	});

    	function div_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			container = $$value;
    			$$invalidate(0, container);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('data' in $$props) $$invalidate(1, data = $$props.data);
    	};

    	$$self.$capture_state = () => ({
    		onMount,
    		Scheduler: Scheduler$1,
    		data,
    		scheduler,
    		container
    	});

    	$$self.$inject_state = $$props => {
    		if ('data' in $$props) $$invalidate(1, data = $$props.data);
    		if ('scheduler' in $$props) $$invalidate(2, scheduler = $$props.scheduler);
    		if ('container' in $$props) $$invalidate(0, container = $$props.container);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*scheduler, data*/ 6) {
    			scheduler?.parse(data);
    		}
    	};

    	return [container, data, scheduler, div_binding];
    }

    class Scheduler_1 extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { data: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Scheduler_1",
    			options,
    			id: create_fragment$1.name
    		});
    	}

    	get data() {
    		throw new Error("<Scheduler>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Scheduler>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    function getData() {
      const events = [
        {
          id: 1,
          start_date: "2023-10-06 02:00",
          end_date: "2023-10-06 09:00",
          text: "Front-end meeting",
        },
        {
          id: 2,
          start_date: "2023-10-07 06:00",
          end_date: "2023-10-07 16:00",
          text: "Feed ducks and city walking",
        },
        {
          id: 3,
          start_date: "2023-10-08 10:00",
          end_date: "2023-10-08 14:00",
          text: "Lunch with Ann & Alex",
        },
        {
          id: 4,
          start_date: "2023-10-08 16:00",
          end_date: "2023-10-08 17:00",
          text: "World Darts Championship (morning session)",
        },
        {
          id: 5,
          start_date: "2023-10-09 12:00",
          end_date: "2023-10-09 20:00",
          text: "Design workshop",
        },
        {
          id: 6,
          start_date: "2023-10-07 14:30",
          end_date: "2023-10-07 16:00",
          text: "World Darts Championship (evening session)",
        },
      ];

      return events;
    }

    /* src\App.svelte generated by Svelte v3.59.2 */

    function create_fragment(ctx) {
    	let scheduler;
    	let current;

    	scheduler = new Scheduler_1({
    			props: { data: getData() },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(scheduler.$$.fragment);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			mount_component(scheduler, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(scheduler.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(scheduler.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(scheduler, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Scheduler: Scheduler_1, getData });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
      target: document.body,
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
