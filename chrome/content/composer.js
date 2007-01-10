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
 * The Original Code is Adblock Plus Element Hiding Helper.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var domainData;
var nodeData;
var selectedNode = null;
var advancedMode = false;
var stylesheetURL;
var previewStyle = null;
var doc;

/*******************
 * NodeData object *
 *******************/

function NodeData(node, parentNode) {
  this.tagName = {value: node.tagName, checked: false};

  if (typeof parentNode == "undefined")
    parentNode = (node.parentNode && node.parentNode.nodeType == node.ELEMENT_NODE ? new NodeData(node.parentNode) : null);
  this.parentNode = parentNode;

  var prevSibling = node.previousSibling;
  while (prevSibling && prevSibling.nodeType != node.ELEMENT_NODE)
    prevSibling = prevSibling.previousSibling;
  this.prevSibling = (prevSibling ? new NodeData(prevSibling, this.parentNode) : null);

  this.attributes = [];
  for (var i = 0; i < node.attributes.length; i++) {
    var attribute = node.attributes[i];
    var data = {name: attribute.name, value: attribute.value, selected: attribute.value, checked: false};
    if (data.name == "id" || data.name == "class")
      this.attributes.unshift(data);
    else
      this.attributes.push(data);
  }

  if (this.attributes.length >= 2 && this.attributes[1].name == "id") {
    // Make sure ID attribute comes first
    var tmp = this.attributes[1];
    this.attributes[1] = this.attributes[0];
    this.attributes[0] = tmp;
  }

  this.customCSS = {selected: "", checked: false};
}

/*******************
 * TreeView object *
 *******************/

function TreeView(tree) {
  var origView = tree.view;
  this.getRowProperties = TreeView_getRowProperties;
  this.getCellProperties = TreeView_getCellProperties;

  createQIProxy(this, origView)

  for (var key in origView) {
    if (this.hasOwnProperty(key))
      continue;

    createPropertyProxy(this, origView, key);
  }

  tree.view = this;
}

function createQIProxy(obj, orig) {
  obj.QueryInterface = function(iid) {
    var impl = orig.QueryInterface(iid);
    if (impl != orig)
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return obj;
  }
}

function createPropertyProxy(obj, orig, key) {
  if (typeof orig[key] == "function") {
    obj[key] = function() {
      return orig[key].apply(orig, arguments);
    }
  }
  else {
    obj.__defineGetter__(key, function() {
      return orig[key];
    });
    obj.__defineSetter__(key, function(value) {
      orig[key] = value;
    });
  }
}

var atomService = Components.classes["@mozilla.org/atom-service;1"]
                            .getService(Components.interfaces.nsIAtomService);
var selectedAtom = atomService.getAtom("selected-false");
var anchorAtom = atomService.getAtom("anchor");

function TreeView_getRowProperties(row, properties) {
  if (!this.selection.isSelected(row))
    properties.AppendElement(selectedAtom);

  var item = this.getItemAtIndex(row);
  if (item && (item.nodeData.expressionRaw != "*" || item.nodeData == nodeData))
    properties.AppendElement(anchorAtom);
}

function TreeView_getCellProperties(row, col, properties) {
  this.getRowProperties(row, properties);
}

/*********************
 * General functions *
 *********************/

function init() {
  var element = window.arguments[0];
  doc = element.ownerDocument;
  var wnd = doc.defaultView;

  nodeData = new NodeData(element);
  nodeData.tagName.checked = true;
  if (nodeData.attributes.length > 0) {
    if (nodeData.attributes[0].name == "id" || nodeData.attributes[0].name == "class") {
      nodeData.attributes[0].selected = nodeData.attributes[0].value;
      nodeData.attributes[0].checked = true;
    }
    else {
      var maxLen = 0;
      var bestAttr = null;
      for (var i = 0; i < nodeData.attributes.length; i++) {
        if (nodeData.attributes[i].value.length > maxLen) {
          maxLen = nodeData.attributes[i].value.length;
          bestAttr = nodeData.attributes[i];
        }
      }
      if (bestAttr) {
        bestAttr.selected = bestAttr.value;
        bestAttr.checked = true;
      }
    }
  }

  var domain = wnd.location.hostname;
  var selectedDomain = domain.replace(/^www\./, "");
  domainData = {value: domain, selected: selectedDomain};

  fillNodes(nodeData);
  setAdvancedMode(document.documentElement.getAttribute("advancedMode") == "true");
  updateExpression();

  new TreeView(document.getElementById("nodes-tree"));

  setTimeout(function() {
    fillDomains(domainData);
    document.getElementById("domainGroup").selectedItem.focus();
    if (document.getElementById("preview").checked)
      togglePreview(true);
  }, 0);
}

function updateExpression() {
  var curNode = nodeData;
  var simpleMode = true;
  while (curNode) {
    var expressionSimple = (curNode.tagName.checked ? curNode.tagName.value : "*");
    var expressionRaw = expressionSimple;

    for (var i = 0; i < curNode.attributes.length; i++) {
      var attr = curNode.attributes[i];

      if (attr.checked) {
        var escapedName = attr.name.replace(/([^\w\-])/g, "\\$1")
                                   .replace(/\\\{/g, "\\7B ")
                                   .replace(/\\\}/g, "\\7D ");
        if (attr.selected != "") {
          var op = "*=";
          if (attr.selected == attr.value)
            op = "=";
          else if (attr.value.substr(0, attr.selected.length) == attr.selected)
            op = "^=";
          else if (attr.value.substr(attr.value.length - attr.selected.length) == attr.selected)
            op = "$=";
  
          if (/[^\w\-]/.test(attr.name) || /[()"]/.test(attr.value))
            expressionSimple = null;
  
          if (expressionSimple != null)
            expressionSimple += "(" + attr.name + op + attr.value + ")";
  
          var escapedValue = attr.value.replace(/"/g, '\\"')
                                      .replace(/\{/, "\\7B ")
                                      .replace(/\}/, "\\7D ");
          expressionRaw += "[" + escapedName + op + '"' + escapedValue + '"' + "]";
        }
        else {
          expressionSimple = null;
          expressionRaw += "[" + escapedName + "]";
        }
      }
    }

    if (curNode.customCSS.checked && curNode.customCSS.selected != "") {
      expressionSimple = null;
      expressionRaw += curNode.customCSS.selected
                                        .replace(/\{/, "\\7B ")
                                        .replace(/\}/, "\\7D ");
    }

    curNode.expressionSimple = expressionSimple;
    curNode.expressionRaw = expressionRaw;

    if (expressionSimple == null || (expressionRaw != "*" && curNode != nodeData))
      simpleMode = false;

    if (curNode.prevSibling)
      curNode = curNode.prevSibling;
    else
      curNode = curNode.parentNode;
  }

  var expression;
  if (simpleMode) {
    expression = domainData.selected + "#" + nodeData.expressionSimple;
    stylesheetURL = "data:text/css," + encodeURIComponent(nodeData.expressionRaw + "{display: none !important;}");
  }
  else {
    expression = nodeData.expressionRaw;

    var isParent = false;
    var isRemoteParent = false;
    var siblingCount = 0;
    var firstRun = true;

    var curData = nodeData;
    while (curData) {
      if (!firstRun && curData.expressionRaw != "*") {
        var parentRelation = "";
        if (isRemoteParent)
          parentRelation = " ";
        else if (isParent)
          parentRelation = " > ";

        var siblingRelation = "";
        for (var i = 0; i < siblingCount; i++)
          siblingRelation += "* + ";
        siblingRelation = siblingRelation.replace(/^\*/, '');

        var relation;
        if (parentRelation != "" && siblingRelation != "")
          relation = siblingRelation + "*" + parentRelation;
        else if (parentRelation != "")
          relation = parentRelation;
        else
          relation = siblingRelation;

        expression = curData.expressionRaw + relation + expression;

        isParent = false;
        isRemoteParent = false;
        siblingCount = 0;
      }
      firstRun = false;

      if (curData.prevSibling) {
        siblingCount++;
        curData = curData.prevSibling;
      }
      else if (curData.parentNode) {
        siblingCount = 0;
        if (isParent)
          isRemoteParent = true;
        else
          isParent = true;
        curData = curData.parentNode;
      }
      else
        curData = null;
    }

    stylesheetURL = "data:text/css," + encodeURIComponent(expression + "{display: none !important;}");
    expression = domainData.selected + "##" + expression;
  }

  document.getElementById("expression").value = expression;

  var tree = document.getElementById("nodes-tree");
  tree.boxObject.invalidateRow(tree.view.selection.currentIndex);

  if (previewStyle)
    previewStyle.setAttribute("href", stylesheetURL);
}

function fillDomains(domainData) {
  var template = document.getElementById("domain-template");
  if (domainData.selected == "")
    template.setAttribute("selected", "true");

  var parts = domainData.value.split(".");
  if (parts[0] == "")
    parts.splice(0, 1);

  for (var i = 1; i <= parts.length; i++) {
    var curDomain = parts.slice(parts.length - i).join(".");

    var node = template.cloneNode(true);
    node.removeAttribute("id");
    node.setAttribute("label", curDomain);
    node.setAttribute("value", curDomain);

    if (domainData.selected == curDomain)
      node.setAttribute("selected", "true");

    template.parentNode.appendChild(node);
  }
}

function fillNodes(nodeData) {
  var curContainer = document.createElement("treechildren");
  var curChildren = null;
  while (nodeData) {
    var id = "";
    var className = "";
    var i = 0;
    if (nodeData.attributes.length > i && nodeData.attributes[i].name == "id")
      id = nodeData.attributes[i++].value;
    if (nodeData.attributes.length > i && nodeData.attributes[i].name == "class")
      className = nodeData.attributes[i++].value;

    var item = document.createElement("treeitem");
    var row = document.createElement("treerow");

    var cell = document.createElement("treecell");
    cell.setAttribute("label", nodeData.tagName.value);
    row.appendChild(cell);

    var cell = document.createElement("treecell");
    cell.setAttribute("label", id);
    row.appendChild(cell);

    var cell = document.createElement("treecell");
    cell.setAttribute("label", className);
    row.appendChild(cell);

    item.appendChild(row);
    item.nodeData = nodeData;

    if (curChildren) {
      item.appendChild(curChildren);
      item.setAttribute("container", "true");
      item.setAttribute("open", "true");
    }
    curChildren = null;

    if (curContainer.firstChild)
      curContainer.insertBefore(item, curContainer.firstChild);
    else
      curContainer.appendChild(item);

    if (nodeData.prevSibling)
      nodeData = nodeData.prevSibling;
    else if (nodeData.parentNode) {
      curChildren = curContainer;
      curContainer = document.createElement("treechildren");
      nodeData = nodeData.parentNode;
    }
    else
      nodeData = null;
  }

  var tree = document.getElementById("nodes-tree");
  var body = document.getElementById("nodes-tree-children");
  while (curContainer.firstChild)
    body.appendChild(curContainer.firstChild);
}

function fillAttributes(nodeData) {
  var template = document.getElementById("attribute-template");
  var customCSS = document.getElementById("attribute-custom");
  var customCSSCheck = document.getElementById("attribute-custom-check");
  var customCSSField = document.getElementById("attribute-custom-field");
  selectedNode = nodeData;

  // Remove everything between our template and the custom CSS field
  var child = template.nextSibling;
  while (child) {
    var nextChild = child.nextSibling;
    if (child == customCSS)
      break;

    child.parentNode.removeChild(child);
    child = nextChild;
  }

  // Add tag name checkbox
  var node = template.cloneNode(true);
  node.hidden = false;
  node.setAttribute("label", node.getAttribute("label") + " " + nodeData.tagName.value);
  node.setAttribute("checked", nodeData.tagName.checked);
  template.parentNode.insertBefore(node, customCSS);

  // Add attribute checkboxes
  for (var i = 0; i < nodeData.attributes.length; i++) {
    var attr = nodeData.attributes[i];

    node = template.cloneNode(true);
    node.hidden = false;
    node.setAttribute("label", attr.name + ": " + attr.value);
    node.setAttribute("checked", attr.checked);
    node.setAttribute("value", attr.name);
    template.parentNode.insertBefore(node, customCSS);
  }

  // Initialize custom CSS field
  customCSSCheck.setAttribute("checked", nodeData.customCSS.checked);
  customCSSField.value = nodeData.customCSS.selected;
}

function togglePreview(preview) {
  if (preview) {
    if (!previewStyle || !previewStyle.parentNode) {
      previewStyle = doc.createElement("link");
      previewStyle.setAttribute("rel", "stylesheet");
      previewStyle.setAttribute("type", "text/css");
      doc.documentElement.appendChild(previewStyle);
    }
    previewStyle.setAttribute("href", stylesheetURL);
  }
  else {
    if (previewStyle && previewStyle.parentNode)
      previewStyle.parentNode.removeChild(previewStyle);
    previewStyle = null;
  }
}

function changeDomain(node) {
  domainData.selected = node.getAttribute("value");
  updateExpression();
}

function toggleAttr(node) {
  if (selectedNode == null)
    return;

  if (node.hasAttribute("value")) {
    var attrName = node.getAttribute("value");
    for (var i = 0; i < selectedNode.attributes.length; i++)
      if (selectedNode.attributes[i].name == attrName)
        selectedNode.attributes[i].checked = node.checked;
  }
  else
    selectedNode.tagName.checked = node.checked;

  updateExpression();
}

function toggleCustomCSS(node) {
  if (selectedNode == null)
    return;

  selectedNode.customCSS.checked = node.checked;
  updateExpression();
}

function setCustomCSS(customCSS) {
  if (selectedNode == null)
    return;

  selectedNode.customCSS.selected = customCSS;
  if (selectedNode.customCSS.checked)
    updateExpression();
}

function setAdvancedMode(mode) {
  advancedMode = mode;

  var dialog = document.documentElement;
  dialog.setAttribute("advancedMode", advancedMode);

  var button = dialog.getButton("disclosure");
  button.setAttribute("label", dialog.getAttribute(advancedMode ? "buttonlabeldisclosure_off" : "buttonlabeldisclosure_on"));

  fillAttributes(nodeData);

  if (advancedMode && selectedNode) {
    var tree = document.getElementById("nodes-tree");

    // Expand all containers
    var items = tree.getElementsByTagName("treeitem");
    for (var i = 0; i < items.length; i++)
      if (items[i].getAttribute("container") == "true")
        items[i].setAttribute("open", "true");

    tree.view.selection.select(tree.view.rowCount - 1);
  }
}

function updateNodeSelection() {
  var tree = document.getElementById("nodes-tree");
  var selection = tree.view.selection;
  if (selection.count < 1)
    return;

  var min = {};
  selection.getRangeAt(0, min, {});

  var item = tree.view
                 .QueryInterface(Components.interfaces.nsITreeContentView)
                 .getItemAtIndex(min.value);
  if (!item || !item.nodeData)
    return;

  fillAttributes(item.nodeData);
}

function addExpression() {
  var abp = Components.classes["@mozilla.org/adblockplus;1"]
                      .createInstance(Components.interfaces.nsIAdblockPlus);
  abp.addPatterns([document.getElementById("expression").value], 1);

  togglePreview(true);
}
