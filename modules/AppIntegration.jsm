/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Element Hiding Helper for Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = ["AppIntegration"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

var AppIntegration =
{
  initialized: false,
  elementMarkerClass: null,
  styleURI: null,

  startup: function()
  {
    if (this.initialized)
      return;
    this.initialized = true;

    Cu.import("chrome://elemhidehelper-modules/content/Aardvark.jsm");
    Cu.import("chrome://elemhidehelper-modules/content/Prefs.jsm");
    Prefs.startup();

    // Use random marker class
    let rnd = [];
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 20; i++)
      rnd.push(offset + Math.random() * 26);

    this.elementMarkerClass = String.fromCharCode.apply(String, rnd);

    // Load CSS asynchronously
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIJSXMLHttpRequest);
    request.open("GET", "chrome://elemhidehelper/content/elementmarker.css");
    request.overrideMimeType("text/plain");
    request.addEventListener("load", function()
    {
      if (!this.initialized)
        return;

      let data = request.responseText.replace(/%%CLASS%%/g, this.elementMarkerClass);
      let styleService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
      this.styleURI = Services.io.newURI("data:text/css," + encodeURIComponent(data), null, null);
      styleService.loadAndRegisterSheet(this.styleURI, Ci.nsIStyleSheetService.USER_SHEET);
    }.bind(this), false);
    request.send(null);

    // Load overlay asynchonously and start attaching to windows once done
    let request2 = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIJSXMLHttpRequest);
    request2.open("GET", "chrome://elemhidehelper/content/overlay.xul");
    request2.addEventListener("load", function()
    {
      if (!this.initialized)
        return;

      WindowObserver.overlay = {__proto__: null, "_processing": []};
      for (let child = request2.responseXML.documentElement.firstElementChild; child; child = child.nextElementSibling)
        if (child.hasAttribute("id"))
          WindowObserver.overlay[child.getAttribute("id")] = child;
      for (let child = request2.responseXML.firstChild; child; child = child.nextSibling)
        if (child.nodeType == child.PROCESSING_INSTRUCTION_NODE)
          WindowObserver.overlay._processing.push(child);
      WindowObserver.startup();
    }.bind(this), false);
    request2.send(null);
  },

  shutdown: function()
  {
    if (!this.initialized)
      return;
    this.initialized = false;

    if (this.styleURI)
    {
      let styleService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
      styleService.unregisterSheet(this.styleURI, Ci.nsIStyleSheetService.USER_SHEET);
      this.styleURI = null;
    }

    Prefs.shutdown();
    Aardvark.quit();
    WindowObserver.shutdown();

    Cu.unload("chrome://elemhidehelper-modules/content/Aardvark.jsm");
    Cu.unload("chrome://elemhidehelper-modules/content/Prefs.jsm");
  }
};

var WindowObserver =
{
  initialized: false,

  overlay: null,

  startup: function()
  {
    if (this.initialized)
      return;
    this.initialized = true;

    let e = Services.ww.getWindowEnumerator();
    while (e.hasMoreElements())
    {
      let window = e.getNext().QueryInterface(Ci.nsIDOMWindow);
      if (window.document.readyState == "complete")
        this.applyToWindow(window);
      else
        this.observe(window, "domwindowopened", null);
    }

    Services.ww.registerNotification(this);
  },

  shutdown: function()
  {
    if (!this.initialized)
      return;
    this.initialized = false;

    let e = Services.ww.getWindowEnumerator();
    while (e.hasMoreElements())
      this.removeFromWindow(e.getNext().QueryInterface(Ci.nsIDOMWindow));

    Services.ww.unregisterNotification(this);
  },

  applyToWindow: function(window)
  {
    if (!window.document.getElementById("abp-hooks"))
      return;

    for (let id in this.overlay)
      if (id != "_processing")
        window.document.documentElement.appendChild(window.document.importNode(this.overlay[id], true));
    for (let i = 0; i < this.overlay._processing.length; i++)
    {
      let node = window.document.importNode(this.overlay._processing[i]);
      node.data += ' class="elemhidehelper-node"';
      window.document.insertBefore(node, window.document.firstChild);
    }

    window._ehhWrapper = new WindowWrapper(window);
  },

  removeFromWindow: function(window)
  {
    if (!window._ehhWrapper)
      return;

    window._ehhWrapper.shutdown();
    delete window._ehhWrapper;

    let remove = [];
    for (let id in this.overlay)
    {
      if (id != "_processing")
      {
        let element = window.document.getElementById(id);
        if (element)
          remove.push(element);
      }
    }

    for (let child = window.document.firstChild; child; child = child.nextSibling)
      if (child.nodeType == child.PROCESSING_INSTRUCTION_NODE && child.data.indexOf("elemhidehelper-node") >= 0)
        remove.push(child);

    for (let i = 0; i < remove.length; i++)
      remove[i].parentNode.removeChild(remove[i]);
  },

  get menuItem()
  {
    let stringBundle = Services.strings.createBundle("chrome://elemhidehelper/locale/global.properties");
    let result = [stringBundle.GetStringFromName("selectelement.label"), stringBundle.GetStringFromName("stopselection.label")];

    delete this.menuItem;
    this.__defineGetter__("menuItem", function() result);
    return this.menuItem;
  },

  observe: function(subject, topic, data)
  {
    if (topic == "domwindowopened")
    {
      let window = subject.QueryInterface(Ci.nsIDOMWindow);
      window.addEventListener("load", function()
      {
        window.setTimeout(function()
        {
          if (this.initialized)
            this.applyToWindow(window);
        }.bind(this), 0);
      }.bind(this), false);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

function WindowWrapper(wnd)
{
  this.window = wnd;
  this.browser = this.E("abp-hooks").getBrowser();

  this.popupShowingHandler = this.popupShowingHandler.bind(this);
  this.popupHidingHandler = this.popupHidingHandler.bind(this);
  this.keyPressHandler = this.keyPressHandler.bind(this);
  this.toggleSelection = this.toggleSelection.bind(this);
  this.hideTooltips = this.hideTooltips.bind(this);
  this.stopSelection = this.stopSelection.bind(this);

  this.E("ehh-elementmarker").firstElementChild.setAttribute("class", AppIntegration.elementMarkerClass);

  this.startup();
}
WindowWrapper.prototype =
{
  window: null,
  browser: null,

  startup: function()
  {
    this.window.addEventListener("popupshowing", this.popupShowingHandler, false);
    this.window.addEventListener("popuphiding", this.popupHidingHandler, false);
    this.window.addEventListener("keypress", this.keyPressHandler, false);
    this.window.addEventListener("blur", this.hideTooltips, true);
    this.browser.addEventListener("select", this.stopSelection, false);
  },

  shutdown: function()
  {
    this.window.removeEventListener("popupshowing", this.popupShowingHandler, false);
    this.window.removeEventListener("popuphiding", this.popupHidingHandler, false);
    this.window.removeEventListener("keypress", this.keyPressHandler, false);
    this.window.removeEventListener("blur", this.hideTooltips, true);
    this.browser.removeEventListener("select", this.stopSelection, false);
  },

  E: function(id)
  {
    let doc = this.window.document;
    this.E = function(id) doc.getElementById(id);
    return this.E(id);
  },

  key: undefined,

  popupShowingHandler: function(event)
  {
    let popup = event.target;
    if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
      return;

    let enabled = Aardvark.canSelect(this.browser);
    let running = (enabled && this.browser == Aardvark.browser);

    let [labelStart, labelStop] = WindowObserver.menuItem;
    let item = popup.ownerDocument.createElement("menuitem");
    item.setAttribute("label", running ? labelStop : labelStart);
    item.setAttribute("class", "elemhidehelper-item");
    if (!enabled)
      item.setAttribute("disabled", "true");

    if (typeof this.key == "undefined")
      this.configureKey(event.currentTarget);
    if (this.key && this.key.text)
      item.setAttribute("acceltext", this.key.text);

    item.addEventListener("command", this.toggleSelection, false);

    let insertBefore = null;
    for (let child = popup.firstChild; child; child = child.nextSibling)
      if (/-options$/.test(child.id))
        insertBefore = child;
    popup.insertBefore(item, insertBefore);
  },

  popupHidingHandler: function(event)
  {
    let popup = event.target;
    if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
      return;

    let items = popup.getElementsByClassName("elemhidehelper-item");
    if (items.length)
      items[0].parentNode.removeChild(items[0]);
  },

  keyPressHandler: function(event)
  {
    if (typeof this.key == "undefined")
      this.configureKey(event.currentTarget);

    if (event.defaultPrevented || !this.key)
      return;
    if (this.key.shift != event.shiftKey || this.key.alt != event.altKey)
      return;
    if (this.key.meta != event.metaKey || this.key.control != event.ctrlKey)
      return;

    if (this.key.char && (!event.charCode || String.fromCharCode(event.charCode).toUpperCase() != this.key.char))
      return;
    else if (this.key.code && (!event.keyCode || event.keyCode != this.key.code))
      return;

    event.preventDefault();
    this.toggleSelection();
  },

  configureKey: function(window)
  {
    let variants = Prefs.selectelement_key;
    let scope = {};
    Services.scriptloader.loadSubScript("chrome://elemhidehelper/content/keySelector.js", scope);
    this.key = scope.selectKey(window, variants);
  },

  hideTooltips: function()
  {
    if (Aardvark.window == this.window)
      Aardvark.hideTooltips();
  },

  toggleSelection: function()
  {
    if (this.browser == Aardvark.browser)
      this.stopSelection();
    else
      this.startSelection();
  },

  startSelection: function()
  {
    Aardvark.start(this);
  },

  stopSelection: function()
  {
    Aardvark.quit();
  }
};
