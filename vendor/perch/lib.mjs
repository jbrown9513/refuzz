import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node2 = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node2.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node2 = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node2.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node2 = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node2.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment2, indent) {
      if (/^\n+$/.test(comment2))
        return comment2.substring(1);
      return indent ? comment2.replace(/^(?! *$)/gm, indent) : comment2;
    }
    var lineComment = (str, indent, comment2) => str.endsWith("\n") ? indentComment(comment2, indent) : comment2.includes("\n") ? "\n" + indentComment(comment2, indent) : (str.endsWith(" ") ? "" : " ") + comment2;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text3, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text3;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text3.length <= endStep)
        return text3;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text3, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text3[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text3[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text3, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text3[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text3[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text3;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text3;
      if (onFold)
        onFold();
      let res = text3.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text3.length;
        if (fold === 0)
          res = `
${indent}${text3.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text3[fold]}\\`;
          res += `
${indent}${text3.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text3, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text3[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text3[++i];
        } else {
          do {
            ch = text3[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text3[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment: comment2, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal3 = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal3 ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment2) {
        header += " " + commentString(comment2.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal3) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge2 = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge2.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge2.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge2.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge2;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge2 = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge2.isMergeKey(ctx, key))
        merge2.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment: comment2, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment3 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment3 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment3 = null, () => chompKeep = true);
        if (comment3)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment3));
        if (chompKeep && comment3)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment2) {
        str += "\n" + stringifyComment.indentComment(commentString(comment2), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment2 = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment2 = ik.comment;
          }
        }
        if (comment2)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment2 = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment2)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment2));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment2, chompKeep) {
      if (comment2 && chompKeep)
        comment2 = comment2.replace(/^\n+/, "");
      if (comment2) {
        const ic = stringifyComment.indentComment(commentString(comment2), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment: comment2, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment: comment2, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge2.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge2.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge2.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge2.merge) ? schemaTags.concat(merge2.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge2.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge2);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment2 = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment2)
              comment2 = cb;
            else
              comment2 += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment2)
                comment2 += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment: comment2,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment2 = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment2)
                comment2 = cb;
              else
                comment2 += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment2)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment: comment2, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment2 = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment2 = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment: comment2, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment: comment2, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment2)
        scalar.comment = comment2;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment: comment2, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment2) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment2;
        else
          node.commentBefore = comment2;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment: comment2, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment2) {
        node.comment = comment2;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment2 = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment2 += (comment2 === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment: comment2, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment: comment2, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment2) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment2}` : comment2;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment2;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment2}
${cb}` : comment2;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment2}
${cb}` : comment2;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme2 of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme2);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/analysis.js
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

// src/treesitter/pack.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire as requireFrom } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
var PACK = "@xberg-io/tree-sitter-language-pack";
var require2 = requireFrom(import.meta.url);
function load() {
  if (process.platform !== "win32") return require2(PACK);
  const addon = join(dirname(require2.resolve(PACK)), `ts-pack-core-node.win32-${process.arch}-msvc.node`);
  if (!existsSync(addon)) return require2(PACK);
  const bytes = readFileSync(addon);
  if (!renameImport(bytes, "node.dll", "node.exe")) return require2(PACK);
  const copy = join(tmpdir(), `perch-${createHash("sha256").update(bytes).digest("hex")}.node`);
  if (!existsSync(copy) || !readFileSync(copy).equals(bytes)) {
    const partial = `${copy}.${process.pid}`;
    writeFileSync(partial, bytes);
    try {
      renameSync(partial, copy);
    } catch (error) {
      rmSync(partial, { force: true });
      if (!existsSync(copy) || !readFileSync(copy).equals(bytes)) throw error;
    }
  }
  const module = { exports: {} };
  process.dlopen(module, copy);
  return module.exports;
}
function renameImport(pe, from, to) {
  if (to.length > from.length || pe.length < 64 || pe.toString("latin1", 0, 2) !== "MZ") return false;
  try {
    const header = pe.readUInt32LE(60);
    if (pe.toString("latin1", header, header + 4) !== "PE\0\0") return false;
    const sections = pe.readUInt16LE(header + 6);
    const optional = header + 24;
    const wide = pe.readUInt16LE(optional) === 523;
    if (pe.readUInt32LE(optional + (wide ? 108 : 92)) < 2) return false;
    const directories2 = optional + (wide ? 112 : 96);
    const table = optional + pe.readUInt16LE(header + 20);
    const offset = (rva) => {
      for (let i = 0; i < sections; i++) {
        const section = table + i * 40;
        const virtualSize = pe.readUInt32LE(section + 8), address = pe.readUInt32LE(section + 12);
        const rawSize = pe.readUInt32LE(section + 16), raw = pe.readUInt32LE(section + 20);
        if (rva >= address && rva - address < Math.min(rawSize, virtualSize || rawSize)) return rva - address + raw;
      }
      return void 0;
    };
    let descriptor = offset(pe.readUInt32LE(directories2 + 8));
    while (descriptor !== void 0 && descriptor + 20 <= pe.length && pe.subarray(descriptor, descriptor + 20).some((byte) => byte !== 0)) {
      const name = offset(pe.readUInt32LE(descriptor + 12));
      if (name !== void 0 && pe.toString("latin1", name, name + from.length + 1).toLowerCase() === `${from.toLowerCase()}\0`) {
        pe.write(`${to}\0`, name, "latin1");
        return true;
      }
      descriptor += 20;
    }
    return false;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
var pack = load();
var pack_default = pack;

// src/treesitter/types.ts
var PARSE_VERSION = "language-pack-1.20-v35";

// src/treesitter/languages.ts
function downloading(use, waits = [1e3, 2e3, 4e3, 8e3]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return use();
    } catch (error) {
      if (attempt >= waits.length || !/download error/i.test(error instanceof Error ? error.message : String(error))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waits[attempt]);
    }
  }
}
var aliases = { c_sharp: "csharp", js: "javascript", jsx: "javascript", ts: "typescript", typescriptreact: "tsx", py: "python", sh: "bash", shell: "bash", rs: "rust", md: "markdown" };
function normalizeLanguage(language) {
  const name = language.trim().toLowerCase();
  const normalized = aliases[name] ?? name;
  return downloading(() => pack_default.hasLanguage(normalized)) ? normalized : null;
}

// src/treesitter/node.ts
var lineStarts = /* @__PURE__ */ new WeakMap();
function pointAt(source, byte) {
  let starts = lineStarts.get(source);
  if (!starts) {
    starts = [0];
    for (let at = source.indexOf(10); at !== -1; at = source.indexOf(10, at + 1)) starts.push(at + 1);
    lineStarts.set(source, starts);
  }
  let low = 0, high = starts.length - 1;
  while (low < high) {
    const middle = low + high + 1 >> 1;
    if (starts[middle] <= byte) low = middle;
    else high = middle - 1;
  }
  return { row: low, column: byte - starts[low] };
}
var Node = class _Node {
  constructor(native, source, parent) {
    this.native = native;
    this.source = source;
    this.#parent = parent;
  }
  native;
  source;
  #type;
  #startIndex;
  #endIndex;
  #startPosition;
  #endPosition;
  #isNamed;
  #isMissing;
  /** The field its parent holds it in, `name` or `body`, read in the cursor pass that built the parent's children. */
  #field = null;
  /**
   * The children, wrapped once and kept, so what one stage read of a node another does not ask native code for again.
   * `#complete` says the whole subtree below is built, by one cursor pass: native `child(i)` counts siblings from the first, so
   * reading a block's children one by one was quadratic in them.
   */
  #children;
  #complete = false;
  /**
   * The node this one was reached from, or undefined when it was not reached from one. Native `parent()` searches down from the
   * root, so it costs the node's depth, and the walks that climb from a node to the function around it paid that at every step:
   * a 34 KB file of nested functions took two minutes to parse. A node reached from its parent keeps it instead.
   */
  #parent;
  get type() {
    return this.#type ??= this.native.kind();
  }
  get startIndex() {
    if (this.#startIndex === void 0) this.#range();
    return this.#startIndex;
  }
  get endIndex() {
    if (this.#endIndex === void 0) this.#range();
    return this.#endIndex;
  }
  /** Both ends of the byte range in one call into native code. */
  #range() {
    const range = this.native.byteRange();
    this.#startIndex = range.start;
    this.#endIndex = range.end;
  }
  get id() {
    return `${this.type}:${this.startIndex}:${this.endIndex}`;
  }
  get startPosition() {
    return this.#startPosition ??= pointAt(this.source, this.startIndex);
  }
  get endPosition() {
    return this.#endPosition ??= pointAt(this.source, this.endIndex);
  }
  get isNamed() {
    return this.#isNamed ??= this.native.isNamed();
  }
  nativeHasError() {
    return this.native.hasError();
  }
  get sexp() {
    return this.native.toSexp();
  }
  get isError() {
    return this.native.isError();
  }
  get isMissing() {
    return this.#isMissing ??= this.native.isMissing();
  }
  /** As many as the cursor that built the children found: the same count, without asking native code. */
  get childCount() {
    return this.children.length;
  }
  get text() {
    return this.source.subarray(this.startIndex, this.endIndex).toString("utf8");
  }
  get parent() {
    if (this.#parent === void 0) {
      const native = this.native.parent();
      this.#parent = native ? new _Node(native, this.source) : null;
    }
    return this.#parent;
  }
  get children() {
    this.#build();
    return this.#children;
  }
  get namedChildren() {
    return this.children.filter((child2) => child2.isNamed);
  }
  child(index) {
    return this.children[index] ?? null;
  }
  /** The first child in that field. The cursor that built the children said which field each is in, so this asks native code nothing. */
  childForFieldName(name) {
    return this.children.find((child2) => child2.#field === name) ?? null;
  }
  /** Every node from this one down, in source order, each with its parent. */
  *walk() {
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      yield node;
      const children = node.children;
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }
  /** One cursor pass over the subtree, giving every node in it its children. */
  #build() {
    if (this.#complete) return;
    this.#children = [];
    const cursor = this.native.walk();
    if (!cursor.gotoFirstChild()) {
      this.#complete = true;
      return;
    }
    const path = [this];
    while (true) {
      const node = new _Node(cursor.node(), this.source, path.at(-1));
      node.#field = cursor.fieldName();
      node.#children = [];
      path.at(-1).#children.push(node);
      if (cursor.gotoFirstChild()) {
        path.push(node);
        continue;
      }
      node.#complete = true;
      while (!cursor.gotoNextSibling()) {
        cursor.gotoParent();
        const finished = path.pop();
        finished.#complete = true;
        if (finished === this) return;
      }
    }
  }
};

// src/treesitter/extensions.ts
function groovyPrefix(node) {
  if (node.type !== "block" || !["command", "end_command"].includes(node.parent?.type ?? "")) return [];
  let prefix = [];
  for (const child2 of node.parent.namedChildren) {
    if (child2.id === node.id) break;
    if (child2.type === "block") prefix = [];
    else if (child2.type === "unit" || child2.type === "operators") prefix.push(child2.text);
  }
  return prefix;
}
var SIGNATURE_WORDS = /* @__PURE__ */ new Set([
  "public",
  "protected",
  "private",
  "static",
  "final",
  "abstract",
  "native",
  "strictfp",
  "def",
  "var",
  "void",
  "boolean",
  "byte",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double"
]);
var signatureWord = (word) => SIGNATURE_WORDS.has(/^\w+/.exec(word)?.[0] ?? "") || /^([a-z_]\w*\.)*[A-Z]/.test(word);
function zigContainerName(node) {
  if (node.type !== "ContainerDecl") return null;
  const suffix = node.parent, union = suffix?.parent, declaration = union?.parent;
  if (suffix?.type !== "SuffixExpr" || union?.type !== "ErrorUnionExpr" || declaration?.type !== "VarDecl") return null;
  return declaration.childForFieldName("variable_type_function");
}
function callableName(node) {
  if (node.type === "Decl") return node.namedChildren.find((child2) => child2.type === "FnProto")?.childForFieldName("function") ?? null;
  if (node.type === "constructor_definition") return node.children.find((child2) => !child2.isNamed && child2.type === "constructor") ?? null;
  if (node.type === "lambda_literal") {
    let parent = node.parent;
    while (parent?.type === "parenthesized_expression") parent = parent.parent;
    if (parent?.type === "property_declaration")
      return parent.namedChildren.find((child2) => child2.type === "variable_declaration")?.namedChildren.find((child2) => child2.type === "simple_identifier") ?? null;
  }
  const prefix = groovyPrefix(node);
  if (!prefix.length || !prefix.every(signatureWord)) return null;
  const call = node.namedChildren[0]?.namedChildren.find((child2) => child2.type === "func");
  return call?.namedChildren.find((child2) => child2.type === "identifier") ?? null;
}
function extraScopeName(node) {
  if (node.type === "ContainerDecl") return zigContainerName(node);
  if (groovyPrefix(node).some((word) => ["class", "interface", "trait", "enum"].includes(word)))
    return node.namedChildren[0]?.namedChildren.find((child2) => child2.type === "identifier") ?? null;
  if (node.type === "lambda_literal" && node.parent?.type === "infix_expression") {
    const siblings = node.parent.namedChildren;
    if (siblings[0]?.type === "object_literal") return siblings.find((child2) => child2.type === "simple_identifier") ?? null;
  }
  return null;
}
var FILLED = /* @__PURE__ */ new Set([";", "_automatic_semicolon"]);
function hasSyntaxError(root, blockMacros = /* @__PURE__ */ new Set(), index = null) {
  if (!root.nativeHasError()) return false;
  const sexp = root.sexp;
  const errors = index ? index.of("ERROR").filter((node) => index.at(node) >= index.at(root) && index.at(node) < index.end(root)) : [...root.walk()].filter((node) => node.type === "ERROR");
  if (/\(ERROR\b/.test(sexp) && errors.some((node) => !blockMacroError(node, blockMacros))) return true;
  return [...sexp.matchAll(/\(MISSING (?:"([^"]+)"|([^\s()]+))\)/g)].some((match) => !FILLED.has(match[1] ?? match[2]));
}
function blockMacroError(error, blockMacros) {
  if (!blockMacros.size) return false;
  const parts = Array.from({ length: error.childCount }, (_, index) => error.child(index)).filter((part) => !part.type.includes("comment"));
  if (!parts.length) return false;
  const siblings = error.parent?.namedChildren.filter((part) => !part.type.includes("comment")) ?? [];
  const at = siblings.findIndex((part) => part.id === error.id);
  const after = at === -1 ? null : siblings[at + 1] ?? null;
  for (let index = 0; index < parts.length; index += 2) {
    const call = parts[index], block = parts[index + 1] ?? after;
    const macro = call.type === "call_expression" ? call.childForFieldName("function") : null;
    if (macro?.type !== "identifier" || !blockMacros.has(macro.text) || block?.type !== "compound_statement") return false;
  }
  return true;
}
function internalLinkage(node, language) {
  if (language !== "c" && language !== "cpp" || node.type !== "function_definition") return false;
  const member = node.parent?.type === "field_declaration_list";
  if (!member && node.namedChildren.some((child2) => child2.type === "storage_class_specifier" && child2.text === "static")) return true;
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === "namespace_definition" && !parent.childForFieldName("name")) return true;
  return false;
}

// src/treesitter/visit.ts
var SyntaxIndex = class {
  all = [];
  #byType = /* @__PURE__ */ new Map();
  #at = /* @__PURE__ */ new Map();
  #end = /* @__PURE__ */ new Map();
  #bySpan = null;
  /** Where a node is in `all`, and where its subtree ends: the subtree is `all[at, end)`. */
  at(node) {
    return this.#at.get(node) ?? -1;
  }
  end(node) {
    return this.#end.get(node) ?? -1;
  }
  /** The nodes of these types, in walk order. */
  of(...types) {
    if (types.length === 1) return this.#byType.get(types[0]) ?? [];
    return types.flatMap((type) => this.#byType.get(type) ?? []).sort((a, b) => this.at(a) - this.at(b));
  }
  /** A node and everything below it, in walk order. A node from outside the walk is walked on its own. */
  within(node) {
    const start = this.at(node);
    return start === -1 ? [...node.walk()] : this.all.slice(start, this.end(node));
  }
  /** The nodes with exactly this byte span, `start:end` as a test case's key writes it, outermost first. */
  spanned(span3) {
    if (!this.#bySpan) {
      this.#bySpan = /* @__PURE__ */ new Map();
      for (const node of this.all) {
        const key = `${node.startIndex}:${node.endIndex}`, same = this.#bySpan.get(key);
        if (same) same.push(node);
        else this.#bySpan.set(key, [node]);
      }
    }
    return this.#bySpan.get(span3) ?? [];
  }
  add(node) {
    this.#at.set(node, this.all.length);
    this.all.push(node);
    const list = this.#byType.get(node.type);
    if (list) list.push(node);
    else this.#byType.set(node.type, [node]);
  }
  close(node) {
    this.#end.set(node, this.all.length);
  }
};
function walk(root, visitors = []) {
  const index = new SyntaxIndex();
  const enters = visitors.filter((visitor) => visitor.enter), exits = visitors.filter((visitor) => visitor.exit);
  const nodes = [root], next = [0];
  index.add(root);
  for (const visitor of enters) visitor.enter(root);
  while (nodes.length) {
    const top = nodes.length - 1, node = nodes[top], children = node.children;
    if (next[top] < children.length) {
      const child2 = children[next[top]++];
      index.add(child2);
      for (const visitor of enters) visitor.enter(child2);
      nodes.push(child2);
      next.push(0);
      continue;
    }
    index.close(node);
    for (const visitor of exits) visitor.exit(node);
    nodes.pop();
    next.pop();
  }
  return index;
}

// src/treesitter/metrics.ts
var STRING_TYPES = /* @__PURE__ */ new Set([
  "string",
  "string_literal",
  "raw_string_literal",
  "interpreted_string_literal",
  "verbatim_string_literal",
  "character_literal",
  "char_literal",
  "char",
  "template_string",
  "regex",
  "regex_literal",
  "heredoc_body",
  "string_lit",
  "str_lit",
  "quoted_atom",
  "sigil"
]);
var INTERPOLATION_TYPES = /* @__PURE__ */ new Set([
  "interpolation",
  "string_interpolation",
  "template_substitution",
  "interpolation_expression",
  "embedded_expression",
  "command_substitution",
  "simple_expansion",
  "expansion"
]);
var LITERAL_WORDS = /* @__PURE__ */ new Set([
  "true",
  "false",
  "True",
  "False",
  "TRUE",
  "FALSE",
  "nil",
  "null",
  "None",
  "nullptr",
  "undefined",
  "NULL"
]);
var IGNORED_TOKENS = /* @__PURE__ */ new Set([
  ")",
  "]",
  "}",
  '"',
  "'",
  "`",
  '"""',
  "'''",
  "${",
  "#{",
  "\\"
]);
var OPEN_PAIRS = {
  "(": "()",
  "[": "[]",
  "{": "{}"
};
var SYMBOLIC_OPERATORS = /* @__PURE__ */ new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "=",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
  "&&",
  "||",
  "!",
  "&",
  "|",
  "^",
  "~",
  "<<",
  ">>",
  ">>>",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "++",
  "--",
  "=>",
  "->",
  "<-",
  "::",
  ":=",
  "?",
  "??",
  "?.",
  ".",
  ",",
  ";",
  ":",
  "...",
  "..",
  "..=",
  "|>",
  "<>"
]);
var FUNCTION_TYPES = /* @__PURE__ */ new Set([
  "function_definition",
  "function_declaration",
  "function_item",
  // A Rust trait's method with no body, `fn next(&mut self) -> u8;`: a declaration a call resolves to, as Java's abstract
  // method is, that runs its implementations.
  "function_signature_item",
  "method_definition",
  "method_declaration",
  "method",
  "singleton_method",
  "constructor_declaration",
  "compact_constructor_declaration",
  "constructor_definition",
  "init_declaration",
  "arrow_function",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "lambda",
  "lambda_expression",
  "lambda_literal",
  "anonymous_function",
  "anonymous_function_expression",
  "closure_expression",
  "function_literal",
  "func_literal",
  "local_function_statement",
  "function",
  "function_expression_body",
  "procedure_definition",
  "procedure_declaration",
  "subroutine",
  "subroutine_definition",
  "subroutine_declaration",
  "function_declarator",
  "function_clause",
  "function_declaration_statement",
  "function_definition_statement",
  "function_def",
  // A Solidity modifier runs around each function that names it: a callable with a body of its own.
  "modifier_definition"
]);
var EXCLUDED_FUNCTION_TYPES = /* @__PURE__ */ new Set(["function_declarator"]);
var ANONYMOUS_FUNCTION_TYPES = /* @__PURE__ */ new Set([
  "arrow_function",
  "function_expression",
  "lambda",
  "lambda_expression",
  "lambda_literal",
  "anonymous_function",
  "anonymous_function_expression",
  "closure_expression",
  "function_literal",
  "func_literal"
]);
var BINDING_TYPES = /* @__PURE__ */ new Set([
  "variable_declarator",
  "assignment",
  "assignment_expression",
  "binary_operator",
  "pair",
  "property_declaration",
  "lexical_declaration"
]);
var ARGUMENT_TYPES = /* @__PURE__ */ new Set(["arguments", "argument_list", "value_argument", "value_arguments", "call_suffix", "annotated_lambda"]);
var CALL_TYPES = /* @__PURE__ */ new Set(["call_expression", "call", "method_invocation", "await_expression"]);
var SCOPE_TYPES = /* @__PURE__ */ new Set([
  "class_definition",
  "class_declaration",
  "class_specifier",
  "struct_specifier",
  "interface_declaration",
  "trait_item",
  "impl_item",
  "namespace_definition",
  "internal_module",
  "module_definition",
  "object_declaration",
  "object_definition",
  "trait_definition",
  "object",
  "enum_declaration",
  "record_declaration",
  "enum_item",
  "module",
  "contract_declaration",
  "library_declaration",
  // Ruby's class, whose methods are `Shop.Cart.total`, as its module's are.
  "class"
]);
var NAME_TYPES = /* @__PURE__ */ new Set([
  "identifier",
  "field_identifier",
  "type_identifier",
  "namespace_identifier",
  "property_identifier",
  "simple_identifier",
  "name",
  "variable",
  "operator_name",
  "destructor_name"
]);
function isComment(node) {
  return node.type.includes("comment") || node.type === "shebang" || node.type === "hash_bang_line";
}
function isFunction(node) {
  if (node.childCount === 0) return false;
  if (extraScopeName(node)) return false;
  if (callableName(node)) return true;
  return FUNCTION_TYPES.has(node.type) && !EXCLUDED_FUNCTION_TYPES.has(node.type);
}
function* walkNodes(root) {
  yield* root.walk();
}
function lineRange(node) {
  const start = node.startPosition.row;
  const end = node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0);
  return [start, Math.max(start + 1, end)];
}
function addLines(target, node) {
  const [start, end] = lineRange(node);
  for (let line = start; line < end; line += 1) target.add(line);
}
function nonblankLines(source) {
  const result = /* @__PURE__ */ new Set();
  let line = 0;
  let hasText = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") {
      if (hasText) result.add(line);
      line += 1;
      hasText = false;
    } else if (character !== "\r" && !/\s/u.test(character)) {
      hasText = true;
    }
  }
  if (hasText) result.add(line);
  return result;
}
function containsInterpolation(node, index) {
  return index.within(node).some((current) => current !== node && INTERPOLATION_TYPES.has(current.type));
}
function isLeaf(node) {
  return node.childCount === 0;
}
function lexeme(node, limitBytes = 4096) {
  const bytes = node.endIndex - node.startIndex;
  return bytes > limitBytes ? `<large-token:${bytes}>` : node.text.trim();
}
function recordToken(node, operators, operands) {
  const token = lexeme(node);
  if (!token || IGNORED_TOKENS.has(token)) return;
  if (token in OPEN_PAIRS) {
    const pair = OPEN_PAIRS[token];
    operators.set(pair, (operators.get(pair) ?? 0) + 1);
  } else if (LITERAL_WORDS.has(token)) {
    operands.set(token, (operands.get(token) ?? 0) + 1);
  } else if (!node.isNamed || SYMBOLIC_OPERATORS.has(token) || node.type === "operator" || node.type === "binary_operator_token" || node.type === "unary_operator_token") {
    operators.set(token, (operators.get(token) ?? 0) + 1);
  } else {
    operands.set(token, (operands.get(token) ?? 0) + 1);
  }
}
function halstead(operators, operands) {
  const n1 = operators.size;
  const n2 = operands.size;
  const N1 = [...operators.values()].reduce((sum, count) => sum + count, 0);
  const N2 = [...operands.values()].reduce((sum, count) => sum + count, 0);
  const vocabulary2 = n1 + n2;
  const length = N1 + N2;
  const calculated_length = (n1 > 0 ? n1 * Math.log2(n1) : 0) + (n2 > 0 ? n2 * Math.log2(n2) : 0);
  const volume = vocabulary2 > 0 ? length * Math.log2(vocabulary2) : 0;
  const difficulty = n2 > 0 ? n1 / 2 * (N2 / n2) : 0;
  const effort = difficulty * volume;
  return {
    distinct_operators: n1,
    distinct_operands: n2,
    total_operators: N1,
    total_operands: N2,
    vocabulary: vocabulary2,
    length,
    calculated_length,
    volume,
    difficulty,
    effort,
    time_seconds: effort / 18,
    bugs: volume / 3e3
  };
}
var nonblankRows = (root) => new Set([...nonblankLines(root.text)].map((line) => line + root.startPosition.row));
function measure(root, excludeNested = false, nonblank = nonblankRows(root), index = walk(root)) {
  const operators = /* @__PURE__ */ new Map();
  const operands = /* @__PURE__ */ new Map();
  const codeLines = /* @__PURE__ */ new Set();
  const comments = /* @__PURE__ */ new Set();
  let opaque_bytes = 0;
  const all = index.all, stop = index.end(root);
  for (let at = index.at(root); at < stop; ) {
    const node = all[at], past = index.end(node);
    if (node !== root && excludeNested && isFunction(node)) {
      at = past;
      continue;
    }
    if (isComment(node)) {
      addLines(comments, node);
      at = past;
      continue;
    }
    if (node.endIndex <= node.startIndex) {
      at = past;
      continue;
    }
    if (node.type === "raw_text" || node.type === "jsx_text" || node.type === "html_text") {
      opaque_bytes += node.endIndex - node.startIndex;
      at = past;
      continue;
    }
    if (STRING_TYPES.has(node.type) && !containsInterpolation(node, index)) {
      const token = lexeme(node);
      operands.set(token, (operands.get(token) ?? 0) + 1);
      addLines(codeLines, node);
      at = past;
      continue;
    }
    if (isLeaf(node)) {
      addLines(codeLines, node);
      recordToken(node, operators, operands);
      at = past;
      continue;
    }
    at += 1;
  }
  const sloc = [...codeLines].filter((line) => nonblank.has(line)).length;
  return {
    halstead: halstead(operators, operands),
    sloc,
    comment_lines: comments.size,
    opaque_bytes
  };
}
function text(node, limit = 160) {
  if (!node) return "";
  if (node.endIndex - node.startIndex > limit * 4) return "<truncated>";
  return node.text.slice(0, limit);
}
function declared(declarator) {
  const scopes = [];
  for (const item of walkNodes(declarator)) {
    if (item.type === "qualified_identifier") {
      const scope = item.childForFieldName("scope");
      if (scope) scopes.push(text(scope.childForFieldName("name") ?? scope));
      const inner = item.childForFieldName("name");
      if (!inner) return { name: null, scopes };
      const rest = declared(inner);
      return { name: rest.name, scopes: [...scopes, ...rest.scopes] };
    }
    if (NAME_TYPES.has(item.type)) return { name: item, scopes };
  }
  return { name: null, scopes };
}
var names = /* @__PURE__ */ new WeakMap();
var remembered = (cache, node, read) => {
  let name = cache.get(node);
  if (name === void 0) {
    name = read(node);
    cache.set(node, name);
  }
  return name;
};
var functionName = (node) => remembered(names, node, readFunctionName);
function readFunctionName(node) {
  const target = node.parent && BINDING_TYPES.has(node.parent.type) ? node.parent.childForFieldName("left") ?? node.parent.childForFieldName("name") : null;
  const assigned = node.type === "function_expression" && target !== null && !/^(?:module\.exports|exports)$/.test(target.text);
  let name = assigned ? null : callableName(node) ?? node.childForFieldName("name");
  if (!name && !ANONYMOUS_FUNCTION_TYPES.has(node.type)) {
    const declarator = node.childForFieldName("declarator");
    if (declarator) name = declared(declarator).name;
  }
  if (!name) {
    let parent = node.parent;
    if (parent && ARGUMENT_TYPES.has(parent.type) && !enclosingFunction(node)) {
      while (parent && (ARGUMENT_TYPES.has(parent.type) || CALL_TYPES.has(parent.type))) parent = parent.parent;
    }
    if (parent && BINDING_TYPES.has(parent.type)) {
      for (const field of ["name", "left", "lhs", "key"]) {
        name = parent.childForFieldName(field);
        if (name) break;
      }
    }
    const bound = parent?.type === "init_declarator" ? parent.childForFieldName("declarator") : parent?.type === "let_declaration" ? parent.childForFieldName("pattern") : null;
    if (bound?.type === "identifier") name = bound;
  }
  if (!name && !ANONYMOUS_FUNCTION_TYPES.has(node.type)) {
    name = node.namedChildren.find((child2) => NAME_TYPES.has(child2.type)) ?? null;
  }
  if (name?.type === "method_index_expression") return text(name).replace(":", ".");
  return text(name) || "<anonymous>";
}
var insideTypeArguments = (node, within) => {
  for (let parent = node.parent; parent && parent.id !== within.id; parent = parent.parent) if (parent.type === "type_arguments") return true;
  return false;
};
var isAnonymousClass = (node) => node.type === "object_creation_expression" && node.namedChildren.some((item) => item.type === "class_body") || node.type === "object_literal";
function scopeName(node) {
  if (node.type === "object" || isAnonymousClass(node)) {
    const holder = node.parent;
    const name2 = holder?.type === "variable_declarator" ? holder.childForFieldName("name") : holder?.type === "assignment_expression" ? holder.childForFieldName("left") : holder?.type === "pair" ? holder.childForFieldName("key") : null;
    return name2 && /^[\p{L}_$][\p{L}\p{N}_$.]*$/u.test(name2.text) ? name2.text : null;
  }
  let name = extraScopeName(node) ?? node.childForFieldName("name");
  if (!name && node.type === "impl_item") return implTypeName(node);
  if (!name) name = node.namedChildren.find((child2) => NAME_TYPES.has(child2.type)) ?? null;
  return text(name) || null;
}
function implTypeName(node) {
  let type = node.childForFieldName("type");
  for (let hops = 0; type && hops < 6; hops++) {
    if (["generic_type", "reference_type", "dynamic_type", "pointer_type", "bounded_type", "abstract_type"].includes(type.type)) {
      type = type.childForFieldName("type") ?? type.namedChildren.find((child2) => !["lifetime", "mutable_specifier", "type_arguments"].includes(child2.type)) ?? null;
    } else if (type.type === "scoped_type_identifier") type = type.childForFieldName("name");
    else break;
  }
  return text(type) || null;
}
function qualifiedScopeName(node, renamed = notRenamed) {
  const parts = [];
  for (let parent = node; parent; parent = parent.parent) {
    const known = renamed(parent);
    if (known !== null) {
      parts.push(known);
      break;
    }
    if (isFunction(parent)) parts.push(functionName(parent));
    else if (SCOPE_TYPES.has(parent.type) || extraScopeName(parent) || isAnonymousClass(parent)) {
      const name = scopeName(parent);
      if (name) parts.push(name);
    }
  }
  return parts.filter(Boolean).reverse().join(".") || null;
}
function receiverName(node) {
  const receiver = node.childForFieldName("receiver");
  if (!receiver) return null;
  const nodes = [...walkNodes(receiver)].reverse();
  const name = nodes.find(
    (item) => (/* @__PURE__ */ new Set(["type_identifier", "identifier", "simple_identifier"])).has(item.type) && !insideTypeArguments(item, receiver)
  );
  return text(name) || null;
}
function declaratorScopes(node) {
  if (ANONYMOUS_FUNCTION_TYPES.has(node.type) || node.childForFieldName("name")) return [];
  const declarator = node.childForFieldName("declarator");
  return declarator ? declared(declarator).scopes : [];
}
var notRenamed = () => null;
var qualifiedNames = /* @__PURE__ */ new WeakMap();
function qualifiedFunctionName(node, renamed = notRenamed) {
  let cache = qualifiedNames.get(renamed);
  if (!cache) {
    cache = /* @__PURE__ */ new WeakMap();
    qualifiedNames.set(renamed, cache);
  }
  return remembered(cache, node, (item) => renamed(item) ?? readQualifiedName(item, renamed));
}
function readQualifiedName(node, renamed) {
  const parts = [];
  let parent = node.parent;
  while (parent) {
    const known = renamed(parent);
    if (known !== null) {
      parts.push(known);
      break;
    }
    if (isFunction(parent)) {
      parts.push(functionName(parent));
    } else if (SCOPE_TYPES.has(parent.type) || extraScopeName(parent) || isAnonymousClass(parent)) {
      const name = scopeName(parent);
      if (name) parts.push(name);
    }
    parent = parent.parent;
  }
  const receiver = receiverName(node);
  if (receiver && !parts.includes(receiver)) parts.push(receiver);
  parts.reverse();
  parts.push(...declaratorScopes(node));
  parts.push(functionName(node));
  return parts.filter(Boolean).join(".") || "<anonymous>";
}
function enclosingFunction(node) {
  let parent = node.parent;
  while (parent && !isFunction(parent)) parent = parent.parent;
  return parent;
}
var isNamed = (qualifiedName) => qualifiedName.split(".").at(-1) !== "<anonymous>";
function parentFunctionName(node, renamed = notRenamed) {
  let parent = node.parent;
  while (parent) {
    if (isFunction(parent)) return qualifiedFunctionName(parent, renamed);
    parent = parent.parent;
  }
  return null;
}
function functionDepth(node) {
  let depth = 0;
  let parent = node.parent;
  while (parent) {
    if (isFunction(parent)) depth += 1;
    parent = parent.parent;
  }
  return depth;
}
function location(node) {
  return {
    start: {
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      byte: node.startIndex
    },
    end: {
      line: node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0),
      column: node.endPosition.column + 1,
      byte: node.endIndex
    }
  };
}
function bounded(value) {
  return Math.min(100, Math.max(0, value));
}
function round(value) {
  return Number(value.toFixed(6));
}
function maintainabilityIndex(volume, sloc, cyclomatic) {
  if (cyclomatic === null) return null;
  if (volume <= 0 && sloc <= 0) return 100;
  const raw = 171 - 5.2 * Math.log(Math.max(volume, 1)) - 0.23 * Math.max(cyclomatic, 1) - 16.2 * Math.log(Math.max(sloc, 1));
  return bounded(raw * 100 / 171);
}
function complexityScore(cyclomatic, maxNesting) {
  if (cyclomatic === null || maxNesting === null) return null;
  const branchPressure = Math.min(1, Math.max(0, (cyclomatic - 1) / 10));
  const nestingPressure = Math.min(1, Math.max(0, maxNesting / 5));
  return bounded(100 * (1 - 0.7 * branchPressure - 0.3 * nestingPressure));
}
function qualityMetrics(measurement, complexity) {
  const mi = maintainabilityIndex(
    measurement.halstead.volume,
    measurement.sloc,
    complexity.cyclomatic_complexity
  );
  const controlScore = complexityScore(
    complexity.cyclomatic_complexity,
    complexity.max_nesting
  );
  const halsteadRisk = bounded(
    100 * Math.min(1, Math.log1p(measurement.halstead.volume) / Math.log(10001))
  );
  const maintainabilityRisk = mi === null ? null : 100 - mi;
  const complexityRisk = controlScore === null ? null : 100 - controlScore;
  const risk = maintainabilityRisk === null ? halsteadRisk : complexityRisk === null ? maintainabilityRisk : 0.65 * maintainabilityRisk + 0.35 * complexityRisk;
  return {
    ...measurement.halstead,
    ...complexity,
    sloc: measurement.sloc,
    comment_lines: measurement.comment_lines,
    opaque_bytes: measurement.opaque_bytes,
    maintainability_index: mi === null ? null : round(mi),
    halstead_risk_score: round(halsteadRisk),
    complexity_score: controlScore === null ? null : round(controlScore),
    risk_score: round(bounded(risk)),
    risk_components: {
      maintainability_risk: maintainabilityRisk === null ? null : round(maintainabilityRisk),
      halstead_risk: round(halsteadRisk),
      complexity_risk: complexityRisk === null ? null : round(complexityRisk)
    }
  };
}

// src/treesitter/references.ts
var IMPORT_TYPES = /* @__PURE__ */ new Set([
  "import_statement",
  "import_from_statement",
  "import_declaration",
  // Go's import_declaration holds one import_spec or a parenthesised list of them, and each spec imports a path of its own.
  "import_spec",
  "use_declaration",
  "using_directive",
  "namespace_use_declaration",
  "preproc_include",
  "package_import",
  "import_directive"
]);
var CALL_TYPES2 = /* @__PURE__ */ new Set([
  "call",
  "call_expression",
  "method_invocation",
  "function_call",
  "function_call_expression",
  "invocation_expression",
  "member_call_expression",
  "nullsafe_member_call_expression",
  "scoped_call_expression"
]);
var MEMBER_CALLS = /* @__PURE__ */ new Set(["method_invocation", "member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression"]);
var NAME_TYPES2 = /* @__PURE__ */ new Set([
  "identifier",
  "field_identifier",
  "property_identifier",
  "type_identifier",
  "simple_identifier",
  "name",
  "variable"
]);
var IMPORT_BINDING_TYPES = /* @__PURE__ */ new Set([
  "aliased_import",
  "dotted_as_name",
  "import_as_name",
  "import_specifier",
  "namespace_import",
  "import_spec",
  "use_as_clause",
  "import_require_clause"
]);
function text2(node, limit = 256) {
  if (!node) return "";
  if (node.endIndex - node.startIndex > limit * 4) return "<dynamic>";
  return node.text.trim().slice(0, limit);
}
function stripModule(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1);
  return trimmed;
}
function child(node, ...fields) {
  for (const field of fields) {
    const result = node.childForFieldName(field);
    if (result) return result;
  }
  return null;
}
function nearestFunction(node) {
  let parent = node.parent;
  while (parent) {
    if (isFunction(parent)) return parent;
    parent = parent.parent;
  }
  return null;
}
function ownerId(node) {
  const owner = nearestFunction(node);
  return owner ? `function:${owner.startIndex}` : "file";
}
function sourceRef(node) {
  return ownerId(node);
}
function referenceBase(node) {
  return child(node, "function", "callee", "name") ?? node.namedChildren.find((item) => !isComment(item)) ?? null;
}
function safeNavigation(value) {
  return value.replace(/[?&]\./gu, ".");
}
var IDENTIFIER = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*$/u;
function validReference(value, language = "") {
  let normalized = value.replaceAll("::", ".");
  if (language === "ruby") normalized = normalized.replace(/^\./, "").replace(/[?!]$/, "");
  if (language === "php") normalized = normalized.replace(/^\\/, "").replaceAll("\\", ".");
  if (value.length > 256 || !normalized || !normalized.split(".").every((part) => IDENTIFIER.test(part))) {
    return "<dynamic>";
  }
  return value;
}
function makeReference(kind, node, values) {
  const point = node.startPosition;
  const sourceLocation = location(node);
  const reference = values.reference ?? values.name ?? "<dynamic>";
  return {
    kind,
    name: values.name || reference,
    reference,
    module: values.module ?? null,
    imported_name: values.imported_name ?? null,
    alias: values.alias ?? null,
    ...values.reexport ? { reexport: true } : {},
    ...values.held ? { held: values.held } : {},
    ...values.args ? { args: values.args } : {},
    ...values.named ? { named: values.named } : {},
    source: sourceRef(node),
    line: point.row + 1,
    column: point.column + 1,
    location: sourceLocation
  };
}
function importModule(node, language) {
  const source = child(node, "source", "path", "module", "module_name", "argument") ?? node.namedChildren.find((item) => item.type === "import_require_clause")?.childForFieldName("source") ?? null;
  if (source) return stripModule(text2(source));
  if (language === "python" && node.type === "import_statement") {
    const imported = node.namedChildren[0] ?? null;
    return stripModule(text2(imported?.childForFieldName("name") ?? imported));
  }
  if (node.type === "preproc_include") {
    const include = node.namedChildren.find((item) => item.type.includes("string"));
    return stripModule(text2(include));
  }
  return stripModule(text2(node.namedChildren[0] ?? null));
}
function bindingName(node) {
  if (node.type === "namespace_import" || node.type === "import_require_clause") {
    const local2 = text2(node.namedChildren.find((item) => item.type === "identifier") ?? node.namedChildren.at(-1));
    return local2 ? { name: "*", alias: local2 } : null;
  }
  if (node.type === "import_spec") {
    const path = stripModule(text2(child(node, "path")));
    return path ? { name: path, alias: text2(child(node, "name")) || path.split("/").at(-1) || path } : null;
  }
  const imported = child(node, "name");
  const alias = child(node, "alias");
  if (imported || alias) {
    const name2 = text2(imported);
    const local2 = text2(alias) || name2;
    return name2 || local2 ? { name: name2 || local2, alias: local2 || null } : null;
  }
  const names2 = node.namedChildren.filter((item) => NAME_TYPES2.has(item.type));
  if (names2.length === 0) return null;
  const name = text2(names2[0]);
  const local = text2(names2.at(-1));
  return name ? { name, alias: local && local !== name ? local : null } : null;
}
function rustUseNames(node, prefix = "") {
  if (node.type === "scoped_use_list") {
    const path2 = text2(child(node, "path"));
    const list = child(node, "list");
    return list ? rustUseNames(list, `${prefix}${path2}::`) : [];
  }
  if (node.type === "use_list") {
    return node.namedChildren.flatMap((item) => rustUseNames(item, prefix));
  }
  if (node.type === "use_as_clause") {
    const path2 = `${prefix}${text2(child(node, "path"))}`.replace(/::self$/u, "");
    const alias = text2(child(node, "alias")) || path2.split("::").at(-1) || path2;
    return [{ name: path2, alias }];
  }
  const path = `${prefix}${text2(node)}`.replace(/::self$/u, "");
  return path ? [{ name: path, alias: path.split("::").at(-1) ?? null }] : [];
}
function pythonImportNames(node, module) {
  const from = child(node, "module_name");
  const names2 = [];
  for (const item of node.namedChildren) {
    const aliased = item.type === "aliased_import";
    if (!aliased && item.type !== "dotted_name" || item.startIndex === from?.startIndex) continue;
    const path = text2(aliased ? child(item, "name") : item);
    const alias = aliased ? text2(child(item, "alias")) : "";
    if (!path) continue;
    if (node.type === "import_statement") names2.push({ node: item, module: path, name: "*", alias: alias || (path.split(".")[0] ?? path), reference: path });
    else names2.push({ node: item, module, name: path, alias: alias || path, reference: !module || module.endsWith(".") ? `${module}${path}` : `${module}.${path}` });
  }
  const wildcard = node.type === "import_from_statement" ? node.namedChildren.find((item) => item.type === "wildcard_import") : void 0;
  if (wildcard) names2.push({ node: wildcard, module, name: "*", alias: "*", reference: !module || module.endsWith(".") ? `${module}*` : `${module}.*` });
  return names2;
}
function importReferences(node, language) {
  if (node.namedChildren.some((item) => item.type === "import_spec" || item.type === "import_spec_list")) return [];
  const module = importModule(node, language);
  const references = [];
  references.push(
    makeReference("import", node, {
      name: module || "<unknown-module>",
      reference: module || "<unknown-module>",
      module: module || null,
      // `#include "ledger.hpp"` brings the whole header in, and binds no name of its own.
      ...node.type === "preproc_include" && module ? { imported_name: "*", alias: "<include>" } : {}
    })
  );
  if (language === "rust" && node.type === "use_declaration") {
    const argument = child(node, "argument");
    if (argument) {
      for (const item of rustUseNames(argument)) {
        references.push(
          makeReference("import", node, {
            name: item.name,
            reference: item.name,
            module: item.name.includes("::") ? item.name.slice(0, item.name.lastIndexOf("::")) : item.name,
            imported_name: item.name.split("::").at(-1) ?? item.name,
            alias: item.alias
          })
        );
      }
    }
    return references;
  }
  if (language === "python") {
    for (const item of pythonImportNames(node, module)) {
      references.push(
        makeReference("import", item.node, {
          name: item.name,
          reference: item.reference,
          module: item.module || null,
          imported_name: item.name,
          alias: item.alias
        })
      );
    }
    return references;
  }
  if (language === "solidity" && module) {
    for (const item of solidityImportNames(node)) {
      references.push(makeReference("import", node, { name: item.name, reference: item.name === "*" ? module : `${module}.${item.name}`, module, imported_name: item.name, alias: item.alias }));
    }
    return references;
  }
  for (const item of walkNodes(node)) {
    if (!IMPORT_BINDING_TYPES.has(item.type)) continue;
    const binding = bindingName(item);
    if (!binding) continue;
    references.push(
      makeReference("import", item, {
        name: binding.name,
        reference: module && binding.name !== module ? `${module}.${binding.name}` : module || binding.name,
        module: module || null,
        imported_name: binding.name,
        alias: binding.alias
      })
    );
  }
  for (const item of walkNodes(node)) {
    if (item.type !== "identifier" || item.parent?.type !== "import_clause") continue;
    const local = text2(item);
    if (!local) continue;
    references.push(
      makeReference("import", item, {
        name: "default",
        reference: module ? `${module}.default` : "default",
        module: module || null,
        imported_name: "default",
        alias: local
      })
    );
  }
  return references;
}
function solidityImportNames(node) {
  const names2 = [];
  const children = node.children;
  let pending = null;
  for (const [at, item] of children.entries()) {
    if (item.type !== "identifier") continue;
    const before = children[at - 1];
    if (before && !before.isNamed && before.text === "as") {
      names2.push({ name: pending ?? "*", alias: item.text });
      pending = null;
    } else {
      if (pending) names2.push({ name: pending, alias: pending });
      pending = item.text;
    }
  }
  if (pending) names2.push({ name: pending, alias: pending });
  return names2.length ? names2 : [{ name: "*", alias: "*" }];
}
var ZIG_PRIMITIVE = /^(?:[iu]\d+|f\d+|bool|void|type|anytype|anyopaque|anyerror|noreturn|usize|isize|comptime_int|comptime_float|c_\w+)$/;
function zigBareType(node) {
  if (!node) return null;
  const written = text2(node).replace(/^(?:\[[^\]]*\]|[?*!]|(?:const|volatile|allowzero)\s+|align\([^)]*\)\s*|[\w.]+!)+/, "").trim();
  if (written === "Self") return "$self";
  return ZIG_PRIMITIVE.test(written) ? null : typeName(written);
}
var ZIG_TRANSPARENT = /* @__PURE__ */ new Set([".?", ".*"]);
function zigChain(node) {
  const calls = [];
  const parts = node.children.filter((child2) => !isComment(child2));
  const head = parts[0];
  let path = head?.type === "IDENTIFIER" ? [head.text] : null;
  let held = null;
  const call = (member, at) => {
    if (path && (member || path.length)) {
      const reference = validReference([...path, ...member ? [member] : []].join("."));
      if (reference === "<dynamic>") held = null;
      else {
        calls.push({ reference, at, held: null });
        held = { call: reference };
      }
    } else if (member && held) {
      const reference = `$receiver.${member}`;
      calls.push({ reference, at, held });
      held = { call: reference, on: held };
    } else held = null;
    path = null;
  };
  for (const part of parts.slice(1)) {
    if (part.type === "FieldOrFnCall") {
      const field = part.childForFieldName("field_access"), fn = part.childForFieldName("function_call");
      if (field) {
        if (path) path.push(field.text);
        else held = null;
      } else if (fn) call(fn.text, fn);
    } else if (part.type === "FnCallArguments") call(null, head);
    else if (part.type === "SuffixOp" && !ZIG_TRANSPARENT.has(part.text)) {
      path = null;
      held = null;
    }
  }
  return { calls, value: held ?? (path?.length === 1 ? { local: path[0] } : null) };
}
function zigImport(node, imports2) {
  const name = node.childForFieldName("variable_type_function");
  const equals = node.children.findIndex((child2) => !child2.isNamed && child2.text === "=");
  let value = equals >= 0 ? node.children[equals + 1] ?? null : null;
  while (value && value.type === "ErrorUnionExpr" && value.namedChildren.length === 1) value = value.namedChildren[0];
  if (!name || value?.type !== "SuffixExpr") return null;
  const [head, ...rest] = value.children.filter((child2) => !isComment(child2));
  let module, bound = [];
  if (head?.type === "BUILTINIDENTIFIER" && head.text === "@import") {
    const argument = rest[0]?.type === "FnCallArguments" && rest[0].namedChildren.length === 1 ? rest[0].namedChildren[0] : null;
    const string = argument ? [...walkNodes(argument)].find((item) => item.type === "STRINGLITERALSINGLE") : null;
    if (!string) return null;
    module = string.text.slice(1, -1);
    rest.shift();
  } else if (head?.type === "IDENTIFIER" && rest.length) {
    const through = imports2.find((item) => item.alias === head.text && item.module);
    if (!through) return null;
    module = through.module;
    if (through.imported_name && through.imported_name !== "*") bound = through.imported_name.split(".");
  } else return null;
  for (const part of rest) {
    const field = part.type === "FieldOrFnCall" ? part.childForFieldName("field_access") : null;
    if (!field) return null;
    bound.push(field.text);
  }
  const imported = bound.length ? bound.join(".") : "*";
  return makeReference("import", node, { name: imported, reference: imported === "*" ? module : `${module}.${imported}`, module, imported_name: imported, alias: text2(name) });
}
function jvmImportReference(node, language) {
  const path = node.namedChildren.find((item) => ["scoped_identifier", "identifier"].includes(item.type));
  if (!path) return null;
  const segment = language === "kotlin" ? "simple_identifier" : "identifier";
  const segments = [...walkNodes(path)].filter((item) => item.type === segment).map((item) => item.text);
  const wildcard = node.namedChildren.some((item) => item.type === "asterisk" || item.type === "wildcard_import");
  const isStatic = language === "java" && Array.from({ length: node.childCount }, (_, index) => node.child(index)).some((item) => item?.type === "static");
  const alias = language === "kotlin" ? node.namedChildren.find((item) => item.type === "import_alias")?.namedChildren[0]?.text ?? null : null;
  const last = segments.at(-1) ?? "";
  const [module, imported, local] = isStatic ? wildcard ? [segments.slice(0, -1), `${last}.*`, "*"] : [segments.slice(0, -2), `${segments.at(-2)}.${last}`, last] : wildcard ? [segments, "*", "*"] : [segments.slice(0, -1), last, alias ?? last];
  const reference = wildcard ? `${segments.join(".")}.*` : segments.join(".");
  return makeReference("import", node, { name: reference, reference, module: module.join("."), imported_name: imported, alias: local });
}
function csharpUsingReference(node) {
  const alias = node.childForFieldName("name");
  const path = node.namedChildren.find((item) => item !== alias && (item.type === "qualified_name" || item.type === "identifier"));
  if (!path) return null;
  const segments = path.text.split(".").map((part) => part.trim());
  const isStatic = node.children.some((item) => item.type === "static");
  const last = segments.at(-1) ?? "";
  const [module, imported, local] = alias ? [segments.slice(0, -1), last, alias.text] : isStatic ? [segments.slice(0, -1), `${last}.*`, "*"] : [segments, "*", "*"];
  const reference = alias || isStatic ? segments.join(".") : `${segments.join(".")}.*`;
  return makeReference("import", node, { name: reference, reference, module: module.join("."), imported_name: imported, alias: local });
}
function swiftImportReference(node) {
  const path = node.namedChildren.find((item) => item.type === "identifier");
  const module = path?.namedChildren.find((item) => item.type === "simple_identifier")?.text ?? null;
  if (!module) return null;
  return makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: module });
}
function scalaImportReferences(node) {
  const segments = node.namedChildren.filter((item) => item.type === "identifier").map((item) => item.text);
  const selectors = node.namedChildren.find((item) => item.type === "namespace_selectors");
  const record = (module, imported, local) => {
    const reference = imported === "*" ? `${module.join(".")}.*` : [...module, imported].join(".");
    return makeReference("import", node, { name: reference, reference, module: module.join("."), imported_name: imported, alias: local });
  };
  if (node.namedChildren.some((item) => item.type === "namespace_wildcard")) return [record(segments, "*", "*")];
  if (selectors) {
    return selectors.namedChildren.flatMap((item) => {
      if (item.type === "identifier") return [record(segments, item.text, item.text)];
      if (item.type === "namespace_wildcard") return [record(segments, "*", "*")];
      if (item.type.endsWith("renamed_identifier")) {
        const name = item.childForFieldName("name")?.text, alias = item.childForFieldName("alias")?.text;
        return name && alias && alias !== "_" ? [record(segments, name, alias)] : [];
      }
      return [];
    });
  }
  return segments.length > 1 ? [record(segments.slice(0, -1), segments.at(-1), segments.at(-1))] : [];
}
function callReference(node, language) {
  if (MEMBER_CALLS.has(node.type)) {
    const object = child(node, "object", "scope");
    const name = text2(child(node, "name"));
    const named3 = validReference(object ? `${pathText(object, language)}.${name}` : name, language);
    return named3 === "<dynamic>" && object ? `$receiver.${name}` : named3;
  }
  const receiver = child(node, "receiver"), method = child(node, "method");
  if (receiver || method) {
    const written = receiver ? `${text2(receiver).replace(/^@(?=[\p{L}_])/u, "this.")}.${text2(method)}` : text2(method);
    const named3 = validReference(safeNavigation(written), language);
    return named3 === "<dynamic>" && receiver && validReference(text2(method), language) !== "<dynamic>" ? `$receiver.${text2(method)}` : named3;
  }
  const callee = referenceBase(node);
  if (language === "solidity") {
    const rebound = solidityCallee(callee);
    if (rebound) return validReference(rebound, language);
  }
  if (callee && ["subscript_expression", "subscript", "index_expression"].includes(callee.type)) {
    const table = child(callee, "object", "value") ?? callee.namedChildren[0] ?? null, index = child(callee, "index") ?? callee.namedChildren[1] ?? null;
    const name = table ? validReference(pathText(table, language), language) : "<dynamic>";
    if (name !== "<dynamic>" && index) {
      const literal3 = ["string", "string_literal"].includes(index.type) ? text2(index).replace(/^["'`]|["'`]$/g, "") : null;
      return literal3 && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(literal3) ? `${name}.${literal3}` : `${name}[]`;
    }
  }
  const named2 = validReference(pathText(callee, language), language);
  if (named2 === "<dynamic>") {
    const split = memberOf(callee, language);
    if (split?.member) return `$receiver.${split.member}`;
  }
  return named2;
}
var unwrapExpression = (node) => node?.type === "expression" && node.namedChildren.length === 1 ? node.namedChildren[0] : node;
function solidityCallee(callee) {
  const member = unwrapExpression(callee);
  if (member?.type !== "member_expression") return null;
  let object = unwrapExpression(child(member, "object"));
  const written = object;
  while (object && (object.type === "unary_expression" || object.type === "binary_expression")) {
    object = unwrapExpression(object.type === "unary_expression" ? child(object, "argument") : child(object, "right"));
  }
  if (!object || object === written) return null;
  return `${text2(object)}.${text2(child(member, "property"))}`;
}
function pathText(callee, language) {
  let written = safeNavigation(text2(callee).replace(/\s*(\.|::|\?\.|&\.|->|\?->)\s*/g, "$1"));
  if (language === "c" || language === "cpp") written = written.replaceAll("->", ".");
  if (language === "php") written = written.replaceAll("?->", ".").replaceAll("->", ".").replace(/^\$this\b/, "this").replace(/^static(?=$|::)/, "self");
  if (language === "lua") written = written.replace(/(?<!:):(?!:)/g, ".");
  if (TYPE_ARGUMENTS.has(language) && written.includes("<")) written = withoutTypeArguments(written.replaceAll("::<", "<"));
  return written;
}
var TYPE_ARGUMENTS = /* @__PURE__ */ new Set(["c", "cpp", "rust"]);
function withoutTypeArguments(written) {
  let depth = 0, kept = "";
  for (const char of written) {
    if (char === "<") depth++;
    else if (char === ">" && depth > 0) depth--;
    else if (depth === 0) kept += char;
  }
  return kept;
}
var calleeOf = (node) => MEMBER_CALLS.has(node.type) || node.type === "call" && child(node, "method") ? node : referenceBase(node);
function memberOf(callee, language) {
  if (!callee) return null;
  if (callee.type === "method_invocation") return { receiver: child(callee, "object"), member: text2(child(callee, "name")) };
  if (MEMBER_CALLS.has(callee.type)) return { receiver: child(callee, "object", "scope"), member: text2(child(callee, "name")) };
  if (callee.type === "call" && child(callee, "method")) return { receiver: child(callee, "receiver"), member: text2(child(callee, "method")) };
  if (callee.type === "dot_index_expression" || callee.type === "method_index_expression") {
    const table = child(callee, "table"), field2 = child(callee, "field", "method");
    return table && field2 ? { receiver: table, member: text2(field2) } : null;
  }
  const receiver = child(callee, "object", "value", "argument", "operand", "expression");
  const field = child(callee, "property", "attribute", "field", "name");
  if (receiver && field && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(text2(field))) return { receiver, member: text2(field) };
  if (language === "kotlin" && callee.type === "navigation_expression") {
    const member = [...walkNodes(callee)].reverse().find((item) => item.type === "simple_identifier");
    if (member && member.endIndex === callee.endIndex) return { receiver: callee.namedChildren[0] ?? null, member: text2(member) };
  }
  if (language === "swift" && callee.type === "navigation_expression") {
    const member = child(callee, "suffix")?.childForFieldName("suffix");
    if (member?.type === "simple_identifier") return { receiver: child(callee, "target"), member: text2(member) };
  }
  return null;
}
function receiverOf(receiver, language) {
  const value = valueOf(receiver, language);
  if (value) return value;
  if (receiver && ["scoped_identifier", "field_expression", "member_expression", "attribute"].includes(receiver.type)) {
    const parts = pathText(receiver, language).split(/::|\./);
    if (parts.length >= 2 && /^[A-Z]/.test(parts.at(-2))) return { type: parts.at(-2) };
  }
  return null;
}
function callReferenceRecord(node, language) {
  const reference = callReference(node, language);
  const hint = reference.startsWith("$receiver.") ? receiverOf(memberOf(calleeOf(node), language)?.receiver ?? null, language) : null;
  return makeReference("call", node, {
    name: reference,
    reference,
    ...hint ? { held: hint } : {},
    ...argumentsOf(node, language) ?? {}
  });
}
var ARGUMENT_LISTS = /* @__PURE__ */ new Set(["arguments", "argument_list", "value_arguments", "call_suffix", "FnCallArguments"]);
var ARGUMENT_WRAPPERS = /* @__PURE__ */ new Set(["argument", "value_argument", "call_argument"]);
function argumentsOf(node, language) {
  let list = child(node, "arguments") ?? node.namedChildren.find((item) => ARGUMENT_LISTS.has(item.type)) ?? null;
  if (list?.type === "call_suffix") list = list.namedChildren.find((item) => item.type === "value_arguments") ?? null;
  if (!list) return null;
  const args = [], named2 = {};
  for (const item of list.namedChildren.filter((entry) => !isComment(entry))) {
    const label = item.type === "keyword_argument" || item.type === "pair" || item.type === "value_argument" && child(item, "name") ? child(item, "name", "key") : null;
    if (label) {
      const held = valueOf(child(item, "value") ?? item.namedChildren.at(-1) ?? null, language);
      if (held) named2[text2(label)] = held;
      continue;
    }
    const value = ARGUMENT_WRAPPERS.has(item.type) ? child(item, "value") ?? item.namedChildren.at(-1) ?? null : item;
    args.push(value ? objectFields(value, language) ?? valueOf(value, language) : null);
  }
  const some = args.some(Boolean);
  if (!some && !Object.keys(named2).length) return null;
  return { ...some ? { args } : {}, ...Object.keys(named2).length ? { named: named2 } : {} };
}
function objectFields(node, language) {
  if (node.type !== "object") return null;
  const fields = {};
  for (const item of node.namedChildren) {
    if (item.type === "shorthand_property_identifier") fields[text2(item)] = { local: text2(item) };
    else if (item.type === "pair") {
      const key = child(item, "key"), held = valueOf(child(item, "value"), language);
      if (key && held) fields[text2(key).replace(/^["']|["']$/g, "")] = held;
    } else if (item.type === "method_definition") {
      const key = child(item, "name");
      if (key) fields[text2(key)] = { fn: `function:${item.startIndex}` };
    }
  }
  return Object.keys(fields).length ? { fields } : null;
}
var PARAMETER_LISTS = /* @__PURE__ */ new Set(["formal_parameters", "parameters", "parameter_list", "function_value_parameters", "method_parameters", "ParamDeclList", "parameter_clause", "lambda_parameters"]);
var PARAMETER_NAMES = /* @__PURE__ */ new Set(["identifier", "simple_identifier", "variable_name", "IDENTIFIER", "field_identifier"]);
function parameterName(item) {
  if (PARAMETER_NAMES.has(item.type)) return text2(item);
  const named2 = child(item, "name", "pattern", "parameter");
  if (named2 && PARAMETER_NAMES.has(named2.type)) return text2(named2);
  const walk2 = (node) => {
    for (const inner of node.namedChildren) {
      if (PARAMETER_NAMES.has(inner.type)) return text2(inner);
      if (inner.type.endsWith("type") || inner.type.includes("type_")) continue;
      const found = walk2(inner);
      if (found) return found;
    }
    return null;
  };
  return walk2(named2 ?? item);
}
function parametersOf(node) {
  const list = child(node, "parameters") ?? node.namedChildren.find((item) => PARAMETER_LISTS.has(item.type)) ?? null;
  if (!list) return [];
  const params = [];
  const items = list.namedChildren.filter((item) => !isComment(item) && !/rest|splat|variadic|spread/.test(item.type) && item.type !== "this");
  items.forEach((item, index) => {
    const pattern = item.type === "object_pattern" ? item : child(item, "pattern")?.type === "object_pattern" ? child(item, "pattern") : null;
    if (pattern) {
      for (const field of pattern.namedChildren) {
        if (field.type === "shorthand_property_identifier_pattern") params.push({ name: text2(field), index, field: text2(field) });
        else if (field.type === "object_assignment_pattern" && child(field, "left")?.type === "shorthand_property_identifier_pattern") params.push({ name: text2(child(field, "left")), index, field: text2(child(field, "left")) });
        else if (field.type === "pair_pattern") {
          const key = child(field, "key"), value = child(field, "value");
          const bound = value?.type === "assignment_pattern" ? child(value, "left") : value;
          if (key && bound && PARAMETER_NAMES.has(bound.type)) params.push({ name: text2(bound), index, field: text2(key) });
        }
      }
      return;
    }
    const name = parameterName(item);
    if (name) params.push({ name, index });
  });
  return params;
}
var IDENTIFIER_TYPES = /* @__PURE__ */ new Set([
  "identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "field_identifier",
  "simple_identifier"
]);
function isPassedAsValue(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "arguments" || parent.type === "argument_list") return true;
  if (parent.type === "field_expression") return false;
  if (parent.type === "expression_list") {
    const left = parent.parent?.childForFieldName("left");
    return !(left && left.startIndex === parent.startIndex && left.endIndex === parent.endIndex);
  }
  for (const field of ["value", "right"]) {
    const held = parent.childForFieldName(field);
    if (held && held.startIndex === node.startIndex && held.endIndex === node.endIndex) return true;
  }
  return false;
}
function methodReferenceName(node) {
  const [receiver, member] = node.namedChildren.length >= 2 ? node.namedChildren : [null, node.namedChildren[0] ?? null];
  const written = node.text.slice(node.text.lastIndexOf("::") + 2).trim();
  const target = receiver ? text2(receiver, 128).replace(/<.*>$/s, "") : "";
  if (written === "new") return target ? validReference(target) : null;
  const name = member?.text === written ? written : written.match(/^[\p{L}_$][\p{L}\p{N}_$]*/u)?.[0];
  if (!name) return null;
  const reference = validReference(target ? `${target}.${name}` : name);
  return reference === "<dynamic>" ? null : reference;
}
function constructedInBody(declarator) {
  return declarator.type === "function_declarator" && declarator.parent?.type === "declaration" && declarator.parent.parent?.type === "compound_statement";
}
function unaliased(index, references) {
  const aliases2 = /* @__PURE__ */ new Map();
  for (const node of index.of("alias_declaration", "type_definition")) {
    const name = node.type === "alias_declaration" ? child(node, "name") : node.type === "type_definition" ? child(node, "declarator") : null;
    const type = name ? bareType(child(node, "type")) : null;
    if (name?.type === "type_identifier" && type && type !== name.text) aliases2.set(name.text, type.replaceAll("::", "."));
  }
  if (!aliases2.size) return;
  const swap = (written) => {
    const [head, ...rest] = written.split(/::|\./);
    return aliases2.has(head) ? [aliases2.get(head), ...rest].join(".") : written;
  };
  for (const reference of references) {
    if (reference.kind === "call") {
      reference.name = swap(reference.name);
      reference.reference = reference.name;
    }
    if (reference.held?.type) reference.held = { ...reference.held, type: swap(reference.held.type) };
  }
}
function cppConstructed(node) {
  const type = child(node, "type");
  if (!type || !["type_identifier", "qualified_identifier", "template_type"].includes(type.type) || /^std::/.test(type.text)) return null;
  const constructs = node.namedChildren.some((item) => item.type === "init_declarator" && ["argument_list", "initializer_list"].includes(child(item, "value")?.type ?? "") || constructedInBody(item));
  return constructs ? bareType(type)?.replaceAll("::", ".") ?? null : null;
}
function valueReference(node) {
  const name = text2(node, 128);
  return makeReference("value", node, { name, reference: name });
}
function rustBound(node, name) {
  const nameOf = (bound) => {
    let type = bound;
    for (let hops = 0; type && hops < 4; hops++) {
      if (type.type === "generic_type") type = child(type, "type") ?? type.namedChildren[0] ?? null;
      else if (type.type === "scoped_type_identifier") type = child(type, "name");
      else if (type.type === "reference_type" || type.type === "dynamic_type") type = child(type, "type") ?? type.namedChildren.at(-1) ?? null;
      else break;
    }
    return type?.type === "type_identifier" ? text2(type) : null;
  };
  const firstBound = (bounds) => {
    for (const item of bounds?.namedChildren ?? []) {
      const found = nameOf(item);
      if (found) return found;
    }
    return null;
  };
  for (let parent = node.parent; parent; parent = parent.parent) {
    for (const parameters of parent.namedChildren.filter((item) => item.type === "type_parameters")) {
      for (const parameter of parameters.namedChildren) {
        if (text2(child(parameter, "name") ?? parameter.namedChildren[0] ?? null) !== name) continue;
        const bound = firstBound(child(parameter, "bounds") ?? parameter.namedChildren.find((item) => item.type === "trait_bounds") ?? null);
        if (bound) return bound;
      }
    }
    for (const clause2 of parent.namedChildren.filter((item) => item.type === "where_clause")) {
      for (const predicate of clause2.namedChildren) {
        if (text2(child(predicate, "left") ?? predicate.namedChildren[0] ?? null) !== name) continue;
        const bound = firstBound(child(predicate, "bounds") ?? predicate.namedChildren.find((item) => item.type === "trait_bounds") ?? null);
        if (bound) return bound;
      }
    }
  }
  return null;
}
function rustImplBound(struct, name) {
  const structName = text2(child(struct, "name"));
  let root = struct;
  while (root.parent) root = root.parent;
  for (const item of walkNodes(root)) {
    if (item.type !== "impl_item" || implTypeName(item) !== structName) continue;
    const parameters = item.namedChildren.find((child2) => child2.type === "type_parameters");
    const probe = parameters?.namedChildren.find((child2) => text2(child2.childForFieldName("name") ?? child2.namedChildren[0] ?? null) === name) ?? null;
    const bound = probe ? rustBound(probe, name) : null;
    if (bound) return bound;
  }
  return null;
}
function macroArguments(tree) {
  const tokens = Array.from({ length: tree.childCount }, (_, index) => tree.child(index)).slice(1, -1);
  const items = [[]];
  for (const token of tokens) {
    if (token.type === ",") items.push([]);
    else items[items.length - 1].push(token);
  }
  return items.filter((item) => item.length).map((item) => {
    const bare = item.filter((token) => !["&", "mut"].includes(token.text));
    return bare.length === 1 && bare[0].type === "identifier" ? { local: bare[0].text } : null;
  });
}
var STD_MACROS = /* @__PURE__ */ new Set([
  "assert",
  "assert_eq",
  "assert_ne",
  "debug_assert",
  "debug_assert_eq",
  "debug_assert_ne",
  "format",
  "format_args",
  "print",
  "println",
  "eprint",
  "eprintln",
  "write",
  "writeln",
  "vec",
  "panic",
  "todo",
  "unimplemented",
  "unreachable",
  "matches",
  "dbg",
  "cfg",
  "env",
  "option_env",
  "concat",
  "stringify",
  "include",
  "include_str",
  "include_bytes",
  "line",
  "column",
  "file",
  "module_path",
  "compile_error",
  "try",
  "thread_local",
  "macro_rules"
]);
function rustMacroCalls(tree) {
  const tokens = Array.from({ length: tree.childCount }, (_, index) => tree.child(index));
  const calls = [];
  const results = /* @__PURE__ */ new Map();
  for (let after = 0; after + 1 < tokens.length; after += 1) {
    const next = tokens[after + 1];
    if (next.type === "!" && tokens[after].type === "identifier" && tokens[after + 2]?.type === "token_tree") {
      const name2 = validReference(tokens[after].text);
      if (name2 !== "<dynamic>" && !STD_MACROS.has(name2) && tokens[after - 1]?.type !== "::") calls.push(makeReference("call", tokens[after], { name: name2, reference: name2 }));
      continue;
    }
    if (next.type !== "token_tree" || next.child(0)?.type !== "(") continue;
    let at = after;
    if (tokens[after].type === ">") {
      let depth = 0, open = after;
      for (; open >= 0; open -= 1) {
        if (tokens[open].type === ">") depth += 1;
        else if (tokens[open].type === "<" && --depth === 0) break;
      }
      if (open < 2 || tokens[open - 1].type !== "::") continue;
      at = open - 2;
    }
    if (tokens[at].type !== "identifier") continue;
    const parts = [tokens[at].text];
    let start = at, broken = false;
    while (start >= 2 && ["::", "."].includes(tokens[start - 1].type)) {
      const before = tokens[start - 2];
      if (!["identifier", "self", "super", "crate"].includes(before.type)) {
        broken = true;
        break;
      }
      parts.unshift(before.text, tokens[start - 1].type);
      start -= 2;
    }
    if (broken && start === at && tokens[at - 1]?.type === ".") {
      const receiver = tokens[at - 2]?.type === "?" ? at - 3 : at - 2;
      if (!results.has(receiver)) continue;
      const held = results.get(receiver) ?? null;
      if (UNWRAPS.has(tokens[at].text)) {
        results.set(after + 1, held);
        continue;
      }
      calls.push(makeReference("call", tokens[at], { name: `$receiver.${tokens[at].text}`, reference: `$receiver.${tokens[at].text}`, held }));
      results.set(after + 1, held ? { call: `$receiver.${tokens[at].text}`, on: held } : null);
      continue;
    }
    if (broken || start >= 1 && ["::", ".", "fn"].includes(tokens[start - 1].type)) continue;
    const name = validReference(parts.join(""));
    if (name === "<dynamic>") continue;
    const args = macroArguments(next);
    calls.push(makeReference("call", tokens[start], { name, reference: name, ...args.some(Boolean) ? { args } : {} }));
    const local = parts.length === 3 && parts[1] === "." ? parts[0] : null;
    results.set(after + 1, local ? { call: `$receiver.${tokens[at].text}`, on: { local } } : { call: name });
  }
  return calls;
}
var MEMBER_TYPES = /* @__PURE__ */ new Set([
  "member_expression",
  "attribute",
  "field_access",
  "field_expression",
  "navigation_expression",
  "selector_expression",
  "member_access_expression"
]);
function memberObject(node) {
  return child(node, "object", "value", "argument", "operand") ?? node.namedChildren[0] ?? null;
}
function isMemberRead(node) {
  if (!MEMBER_TYPES.has(node.type)) return false;
  const parent = node.parent?.type === "expression" && node.parent.namedChildren.length === 1 ? node.parent.parent : node.parent;
  if (!parent) return true;
  if (MEMBER_TYPES.has(parent.type) && memberObject(parent)?.id === node.id) return false;
  if (MEMBER_CALLS.has(parent.type) && child(parent, "object", "scope")?.id === node.id) return false;
  const callee = CALL_TYPES2.has(parent.type) ? referenceBase(parent) : null;
  return !(callee && (callee.id === node.id || callee.type === "expression" && callee.namedChildren[0]?.id === node.id));
}
var COMMONJS = /* @__PURE__ */ new Set(["javascript", "typescript", "tsx"]);
function reexportReferences(node) {
  const module = stripModule(text2(node.childForFieldName("source")));
  const record = (imported, alias) => makeReference("import", node, { name: module, reference: module, module, imported_name: imported, alias, reexport: true });
  const clause2 = node.namedChildren.find((item) => item.type === "export_clause");
  if (!clause2) {
    const namespace = node.namedChildren.find((item) => item.type === "namespace_export");
    return [record("*", namespace ? text2(namespace.namedChildren.at(-1) ?? null) || null : null)];
  }
  return clause2.namedChildren.filter((item) => item.type === "export_specifier").map((item) => {
    const name = text2(item.childForFieldName("name"));
    return record(name, text2(item.childForFieldName("alias")) || name);
  });
}
function isRequire(node, language) {
  if (!COMMONJS.has(language) || node.type !== "call_expression") return false;
  const callee = referenceBase(node);
  const argument = child(node, "arguments")?.namedChildren[0] ?? null;
  return callee?.type === "identifier" && text2(callee) === "require" && argument?.type === "string";
}
function requiredModule(node) {
  const argument = child(node, "arguments")?.namedChildren.find((item) => !isComment(item)) ?? null;
  return argument?.type === "string" ? stripModule(text2(argument)) : null;
}
function rubyRequire(node) {
  if (node.type !== "call" || child(node, "receiver")) return [];
  const method = text2(child(node, "method"));
  if (method !== "require" && method !== "require_relative") return [];
  const named2 = requiredModule(node);
  if (!named2) return [];
  const module = method === "require_relative" && !/^\.\.?\//.test(named2) ? `./${named2}` : named2;
  return [makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: null })];
}
function luaRequire(node) {
  if (node.type !== "function_call" || text2(child(node, "name")) !== "require") return [];
  const module = requiredModule(node);
  if (!module) return [];
  const list = node.parent?.type === "expression_list" ? node.parent : null;
  const assignment = list?.parent?.type === "assignment_statement" ? list.parent : null;
  const names2 = assignment?.namedChildren.find((item) => item.type === "variable_list")?.namedChildren ?? [];
  const bound = list?.namedChildren.length === 1 && names2.length === 1 && names2[0].type === "identifier" ? text2(names2[0]) : null;
  return [makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: bound })];
}
var PHP_INCLUDES = /* @__PURE__ */ new Set(["require_expression", "require_once_expression", "include_expression", "include_once_expression"]);
function phpInclude(node) {
  if (!PHP_INCLUDES.has(node.type)) return [];
  const argument = node.namedChildren.find((item) => !isComment(item)) ?? null;
  let module = null;
  if (argument?.type === "string" || argument?.type === "encapsed_string") module = stripModule(text2(argument));
  else if (argument?.type === "binary_expression" && text2(child(argument, "left")) === "__DIR__") {
    const right = child(argument, "right");
    if (right?.type === "string" || right?.type === "encapsed_string") module = `.${stripModule(text2(right))}`;
  }
  if (!module) return [];
  return [makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: null })];
}
function phpUseReferences(node) {
  const references = [];
  const group = child(node, "body");
  const prefix = group ? text2(node.namedChildren.find((item) => item.type === "namespace_name") ?? null) : "";
  const clauses = (group ?? node).namedChildren.filter((item) => item.type === "namespace_use_clause");
  for (const clause2 of clauses) {
    const path = clause2.namedChildren.find((item) => item.type === "qualified_name" || item.type === "name");
    if (!path) continue;
    const segments = [...prefix ? prefix.split("\\") : [], ...text2(path).replace(/^\\/, "").split("\\")];
    const name = segments.pop() ?? "";
    const alias = text2(child(clause2, "alias")) || name;
    const module = segments.join("\\");
    references.push(makeReference("import", clause2, { name: module ? `${module}\\${name}` : name, reference: module ? `${module}\\${name}` : name, module, imported_name: name, alias }));
  }
  return references;
}
function requireReferences(node) {
  const module = stripModule(text2(child(node, "arguments")?.namedChildren[0] ?? null));
  const bound = node.parent?.type === "variable_declarator" ? node.parent.childForFieldName("name") : null;
  const record = (imported, alias) => makeReference("import", node, { name: module, reference: module, module, imported_name: imported, alias });
  if (bound?.type === "identifier") return [record("*", text2(bound))];
  const assigned = node.parent?.type === "assignment_expression" ? node.parent.childForFieldName("left") : null;
  const passed = assigned && /^(?:module\.)?exports\.([\p{L}_$][\p{L}\p{N}_$]*)$/u.exec(text2(assigned));
  if (passed) return [makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: passed[1], reexport: true })];
  if (bound?.type === "object_pattern") {
    const names2 = bound.namedChildren.flatMap((item) => {
      if (item.type === "shorthand_property_identifier_pattern") return [record(text2(item), text2(item))];
      if (item.type === "pair_pattern") return [record(text2(item.childForFieldName("key")), text2(item.childForFieldName("value")))];
      return [];
    });
    if (names2.length) return names2;
  }
  return [record("*", null)];
}
var WRAPPERS = /* @__PURE__ */ new Set(["Option", "Result", "Box", "Rc", "Arc", "RefCell", "Cow", "Optional", "Promise", "Awaitable", "Future", "unique_ptr", "shared_ptr"]);
function typeName(written) {
  let type = written.replace(/^:\s*/, "").replace(/^->\s*/, "").replace(/\s+/g, " ").trim().replace(/^(const|mut|dyn|impl|final|readonly)\s+/, "").replace(/[*&]+/g, "").replace(/^(mut|const)\s+/, "").replace(/\s+(const)$/, "").trim();
  const generic = /^([\p{L}_][\p{L}\p{N}_.:]*)\s*<(.*)>$/su.exec(type);
  if (generic) {
    const head = generic[1].split(/::|\./).at(-1);
    if (WRAPPERS.has(head)) {
      let depth = 0, first = "";
      for (const character of generic[2]) {
        if (character === "<") depth++;
        if (character === ">") depth--;
        if (character === "," && depth === 0) break;
        first += character;
      }
      return typeName(first);
    }
    type = generic[1];
  }
  type = type.replace(/\[\]$/, "").replace(/\s/g, "");
  return /^[\p{L}_][\p{L}\p{N}_.:]*$/u.test(type) && !["var", "auto", "Self", "self"].includes(type) ? type : null;
}
var bareType = (node) => {
  if (!node || ["placeholder_type_specifier", "void_type", "primitive_type", "integral_type", "floating_point_type", "boolean_type", "unit_type"].includes(node.type)) return null;
  if (node.type === "optional_type") return bareType(node.namedChildren[0] ?? null);
  if (node.type === "union_type") {
    const named2 = node.namedChildren.filter((item) => item.type === "named_type");
    return named2.length === 1 ? bareType(named2[0]) : null;
  }
  if (node.type === "named_type") return typeName(text2(node).split("\\").at(-1) ?? "");
  return typeName(text2(node));
};
var constructedType = (node) => bareType(child(node, "constructor", "type", "name") ?? node.namedChildren.find((item) => item.type === "name" || item.type === "qualified_name") ?? null);
var PASS_THROUGH = /* @__PURE__ */ new Set(["Some", "Ok", "Box::new", "Rc::new", "Arc::new", "RefCell::new", "Optional.of", "Promise.resolve"]);
var UNWRAPS = /* @__PURE__ */ new Set([
  "unwrap",
  "expect",
  "unwrap_or_default",
  "unwrap_or",
  "unwrap_or_else",
  "clone",
  "to_owned",
  "get",
  "orElseThrow",
  "value",
  "map_err",
  "ok_or",
  "ok_or_else",
  "context",
  "with_context",
  "as_ref",
  "as_mut",
  "borrow",
  "borrow_mut"
]);
function valueOf(value, language) {
  if (!value) return null;
  if (["parenthesized_expression", "await_expression", "try_expression", "reference_expression"].includes(value.type)) return valueOf(value.namedChildren.at(-1) ?? null, language);
  if (["expression", "ErrorUnionExpr"].includes(value.type) && value.namedChildren.length === 1) return valueOf(value.namedChildren[0], language);
  if (value.type === "UnaryExpr" && ["try", "await"].includes(child(value, "operator")?.text ?? "")) return valueOf(child(value, "left"), language);
  if (value.type === "SuffixExpr") return zigChain(value).value;
  if (["this", "self"].includes(value.type) || value.type === "identifier" && text2(value) === "self" || value.type === "variable_name" && text2(value) === "$this") return { type: "$self" };
  if (value.type === "identifier") return { local: text2(value) };
  if (ANONYMOUS_FUNCTION_TYPES.has(value.type)) return { fn: `function:${value.startIndex}` };
  if (value.type === "object") return objectFields(value, language);
  if (["subscript_expression", "index_expression", "subscript", "element_reference"].includes(value.type)) return valueOf(child(value, "object", "value") ?? value.namedChildren[0] ?? null, language);
  if (CALL_TYPES2.has(value.type)) {
    const callee = referenceBase(value);
    const constructed = callee?.type === "expression" ? callee.namedChildren[0] : callee;
    if (constructed?.type === "new_expression") return { type: bareType(child(constructed, "constructor", "type", "name")) };
    const argument = child(value, "arguments")?.namedChildren.find((item) => !isComment(item)) ?? null;
    if (PASS_THROUGH.has(pathText(callee, language))) return valueOf(argument, language);
    const split = memberOf(callee, language);
    if (split && UNWRAPS.has(split.member)) return valueOf(split.receiver, language);
  }
  if (language === "scala" && value.type === "field_expression") {
    const name = validReference(pathText(value, language));
    if (name !== "<dynamic>") return { call: name };
    const split = memberOf(value, language);
    const on = split ? receiverOf(split.receiver, language) : null;
    return on && split?.member ? { call: `$receiver.${split.member}`, on } : null;
  }
  if (value.type === "new_expression" || value.type === "object_creation_expression") return { type: constructedType(value) };
  if (value.type === "struct_expression") return { type: bareType(child(value, "name")) };
  if (language === "go") {
    if (value.type === "unary_expression" && value.children[0]?.text === "&") return valueOf(child(value, "operand"), language);
    const made = value.type === "composite_literal" ? bareType(child(value, "type")) : value.type === "call_expression" && referenceBase(value)?.text === "new" ? bareType(child(value, "arguments")?.namedChildren[0] ?? null) : null;
    if (made) return { type: made };
  }
  if (value.type === "instance_expression") return { type: bareType(value.namedChildren.find((item) => item.type.endsWith("type") || item.type === "type_identifier") ?? null) };
  if (CALL_TYPES2.has(value.type)) {
    const callee = callReference(value, language);
    if (callee === "<dynamic>") return null;
    const on = callee.startsWith("$receiver.") ? receiverOf(memberOf(calleeOf(value), language)?.receiver ?? null, language) : null;
    return on ? { call: callee, on } : { call: callee };
  }
  return null;
}
function bindingOf(node, language) {
  let name, type = null, value = null, constructed = null;
  if (node.type === "variable_declarator") {
    name = child(node, "name");
    value = child(node, "value");
    type = child(node, "type") ?? (["local_variable_declaration", "field_declaration", "variable_declaration"].includes(node.parent?.type ?? "") ? child(node.parent, "type") : null);
    if (!value && node.parent?.type === "variable_declaration") value = node.namedChildren.find((item) => item !== name && !isComment(item)) ?? null;
  } else if (node.type === "assignment" || node.type === "assignment_expression") {
    name = child(node, "left", "target");
    value = child(node, "right", "result");
    if (name?.type === "directly_assignable_expression") name = name.namedChildren[0] ?? null;
  } else if (node.type === "property_declaration" && language === "swift") {
    name = child(node, "name")?.childForFieldName("bound_identifier") ?? null;
    type = node.namedChildren.find((item) => item.type === "type_annotation")?.childForFieldName("name") ?? null;
    value = child(node, "value");
  } else if (node.type === "val_definition" || node.type === "var_definition") {
    name = child(node, "pattern");
    type = child(node, "type");
    value = child(node, "value");
    if (value?.type === "wildcard") value = null;
  } else if (node.type === "assignment_statement" && language === "lua") {
    const names2 = node.namedChildren.find((item) => item.type === "variable_list")?.namedChildren ?? [];
    const values = node.namedChildren.find((item) => item.type === "expression_list")?.namedChildren ?? [];
    if (names2.length !== 1 || values.length !== 1) return null;
    name = names2[0];
    value = values[0];
  } else if (node.type === "call" && language === "ruby") {
    const method = text2(child(node, "method")), symbol = child(node, "arguments")?.namedChildren[0], block = child(node, "block");
    if (!["let", "let!", "subject"].includes(method) || child(node, "receiver") || symbol?.type !== "simple_symbol" || !block) return null;
    const last = child(block, "body")?.namedChildren.filter((item) => !isComment(item)).at(-1) ?? null;
    const held2 = valueOf(last, language);
    return held2 ? { name: symbol.text.slice(1), held: held2 } : null;
  } else if (node.type === "property_declaration" && language === "php") {
    type = child(node, "type");
    name = node.namedChildren.find((item) => item.type === "property_element")?.childForFieldName("name") ?? null;
    const written2 = name ? `this.${text2(name).replace(/^\$/, "")}` : "";
    const declared3 = bareType(type);
    return written2 && declared3 ? { name: written2, held: { type: declared3 } } : null;
  } else if (node.type === "field_declaration" && (language === "cpp" || language === "c")) {
    type = child(node, "type");
    const declarator = child(node, "declarator");
    name = declarator?.type === "pointer_declarator" || declarator?.type === "reference_declarator" ? declarator.namedChildren.at(-1) ?? null : declarator;
  } else if (node.type === "property_declaration" && language === "kotlin") {
    const variable = node.namedChildren.find((item) => item.type === "variable_declaration");
    if (!variable) return null;
    name = variable.namedChildren.find((item) => item.type === "simple_identifier") ?? null;
    type = variable.namedChildren.find((item) => item.type === "user_type" || item.type === "nullable_type") ?? null;
    const after = node.namedChildren.slice(node.namedChildren.indexOf(variable) + 1).filter((item) => !isComment(item));
    value = after.find((item) => !["property_delegate", "getter", "setter", "type_constraints"].includes(item.type)) ?? null;
  } else if (node.type === "let_declaration") {
    name = child(node, "pattern");
    type = child(node, "type");
    value = child(node, "value");
  } else if (node.type === "init_declarator" || node.type === "declaration" && language !== "python") {
    const declaration = node.type === "init_declarator" ? node.parent : node;
    if (declaration?.type !== "declaration") return null;
    type = child(declaration, "type");
    const declarator = node.type === "init_declarator" ? child(node, "declarator") : child(node, "declarator");
    name = declarator?.type === "pointer_declarator" || declarator?.type === "reference_declarator" ? declarator.namedChildren.at(-1) ?? null : declarator && constructedInBody(declarator) ? child(declarator, "declarator") : declarator;
    if (node.type === "init_declarator") value = child(node, "value");
    if (value?.type === "argument_list" || value?.type === "initializer_list") value = null;
  } else if (node.type === "VarDecl") {
    name = child(node, "variable_type_function");
    const colon = node.children.findIndex((item) => !item.isNamed && item.text === ":"), equals = node.children.findIndex((item) => !item.isNamed && item.text === "=");
    type = colon >= 0 ? node.children[colon + 1] ?? null : null;
    value = equals >= 0 ? node.children[equals + 1] ?? null : null;
    if (value && node.children[equals + 2]?.type === "InitList") {
      constructed = typeName(text2(value));
      value = null;
    }
  } else if (node.type === "state_variable_declaration") {
    name = child(node, "name");
    type = child(node, "type");
    value = child(node, "value");
  } else return null;
  const written = text2(name).replace(/^self\./, "this.").replace(/^@(?=[\p{L}_])/u, "this.").replace(/^\$this->/, "this.");
  if (!written || written === "_" || !/^(this\.)?[\p{L}_$][\p{L}\p{N}_$]*$/u.test(written)) return null;
  const held = valueOf(value, language) ?? (constructed ? { type: constructed } : null);
  const declared2 = node.type === "VarDecl" ? zigBareType(type) : bareType(type);
  if (!declared2 && !held) return null;
  return { name: written, held: held?.fields ? { ...held, ...declared2 ? { type: declared2 } : {} } : declared2 ? { type: declared2 } : held };
}
function goBindings(node) {
  const bound = [];
  const identifiers = (within) => (within?.namedChildren ?? []).filter((item) => item.type === "identifier");
  const assigns = node.type === "assignment_statement" && (child(node, "operator") ?? node.children.find((item) => !item.isNamed))?.text === "=";
  if (node.type === "short_var_declaration" || assigns) {
    const names2 = child(node, "left")?.namedChildren ?? [], values = child(node, "right")?.namedChildren ?? [];
    for (const [at, name] of names2.entries()) {
      const value = values.length === names2.length ? values[at] : at === 0 && values.length === 1 ? values[0] : null;
      const held = value ? valueOf(value, "go") : null;
      if (name.type === "identifier" && held) bound.push({ name: name.text, held });
    }
  } else if (node.type === "var_spec") {
    const declared2 = bareType(child(node, "type"));
    const held = declared2 ? { type: declared2 } : valueOf(child(node, "value")?.namedChildren[0] ?? null, "go");
    if (held) for (const name of identifiers(node)) bound.push({ name: name.text, held });
  } else if (node.type === "parameter_declaration" || node.type === "variadic_parameter_declaration") {
    const declared2 = bareType(child(node, "type"));
    if (declared2) for (const name of identifiers(node)) bound.push({ name: name.text, held: { type: declared2 } });
  }
  return bound;
}
function goResult(node) {
  const result = child(node, "result");
  if (result?.type !== "parameter_list") return result;
  const first = result.namedChildren.find((item) => item.type === "parameter_declaration");
  return first ? child(first, "type") ?? first : null;
}
function basesOf(node) {
  const names2 = [];
  if (node.type === "impl_item") {
    let trait = child(node, "trait");
    if (trait?.type === "generic_type") trait = child(trait, "type") ?? trait.namedChildren[0] ?? null;
    if (trait?.type === "scoped_type_identifier") trait = child(trait, "name");
    return trait ? [text2(trait)] : [];
  }
  if (isAnonymousClass(node)) {
    let base = node.type === "object_creation_expression" ? child(node, "type") : node.namedChildren.find((item) => item.type === "delegation_specifier")?.namedChildren.flatMap((item) => [...walkNodes(item)]).find((item) => item.type === "user_type" || item.type === "type_identifier") ?? null;
    if (base?.type === "generic_type") base = child(base, "type") ?? base.namedChildren[0] ?? null;
    return base ? [text2(base).split("<")[0]] : [];
  }
  if (["class_definition", "object_definition", "trait_definition"].includes(node.type)) names2.push(...child(node, "extend")?.namedChildren.filter((item) => item.type.endsWith("type") || item.type === "type_identifier") ?? []);
  if (node.type === "class_definition") names2.push(...child(node, "superclasses")?.namedChildren ?? []);
  else if (node.type === "contract_declaration") {
    for (const item of node.namedChildren.filter((item2) => item2.type === "inheritance_specifier")) {
      const base = child(item, "ancestor") ?? item.namedChildren[0];
      if (base) names2.push(base);
    }
  } else if (node.type === "class_declaration" || node.type === "class" || node.type === "class_specifier" || node.type === "struct_specifier") {
    const superclass = child(node, "superclass");
    if (superclass) names2.push(...superclass.namedChildren);
    for (const item of node.namedChildren.filter((item2) => item2.type === "inheritance_specifier")) names2.push(child(item, "inherits_from") ?? item);
    for (const list of node.namedChildren.filter((item) => ["class_heritage", "super_interfaces", "base_class_clause", "base_list", "base_clause", "class_interface_clause"].includes(item.type))) {
      for (const item of list.namedChildren) {
        if (item.type === "extends_clause") names2.push(child(item, "value") ?? item.namedChildren[0]);
        else if (item.type === "implements_clause" || item.type === "type_list") names2.push(...item.namedChildren);
        else if (item.type !== "access_specifier") names2.push(item);
      }
    }
  }
  return names2.map((item) => typeName(text2(item).replace(/^(public|private|protected|virtual)\s+/, ""))).filter((name) => Boolean(name) && name !== "object");
}
function parameterOf(node) {
  let name, type;
  if (node.type === "typed_parameter") {
    name = node.namedChildren.find((item) => item.type === "identifier") ?? null;
    type = child(node, "type");
  } else if (node.type === "typed_default_parameter") {
    name = child(node, "name");
    type = child(node, "type");
  } else if (node.type === "required_parameter" || node.type === "optional_parameter") {
    name = child(node, "pattern");
    type = child(node, "type");
  } else if (node.type === "formal_parameter" || node.type === "parameter" || node.type === "class_parameter") {
    name = child(node, "name", "pattern");
    type = child(node, "type");
    if (!type && name?.type === "simple_identifier") type = node.namedChildren.find((item) => item.type === "user_type" || item.type.endsWith("_type")) ?? null;
  } else if (node.type === "simple_parameter" || node.type === "property_promotion_parameter") {
    name = child(node, "name");
    type = child(node, "type");
  } else if (node.type === "enhanced_for_statement") {
    name = child(node, "name");
    type = child(node, "type");
  } else if (node.type === "catch_formal_parameter") {
    name = child(node, "name");
    type = node.namedChildren.find((item) => item.type === "catch_type") ?? null;
  } else if (node.type === "parameter_declaration") {
    type = child(node, "type");
    let declarator = child(node, "declarator");
    while (declarator && ["reference_declarator", "pointer_declarator"].includes(declarator.type)) declarator = declarator.namedChildren.at(-1) ?? null;
    name = declarator;
  } else if (node.type === "ParamDecl") {
    name = child(node, "parameter");
    type = node.namedChildren.find((item) => item.type === "ParamType") ?? null;
  } else return null;
  const written = text2(name).replace(/^mut\s+/, "");
  const kind = node.type === "ParamDecl" ? zigBareType(type) : bareType(type);
  return kind && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(written) ? { name: written, held: { type: kind } } : null;
}
function declaredReturn(node, language) {
  if (!isFunction(node)) return null;
  if (language === "zig") {
    const last = node.namedChildren.find((item) => item.type === "FnProto")?.namedChildren.at(-1);
    return last && !["IDENTIFIER", "ParamDeclList"].includes(last.type) ? zigBareType(last) : null;
  }
  const arrow = language === "swift" ? node.children.findIndex((item) => item.type === "->") : -1;
  const declared2 = child(node, "return_type", "returns") ?? (["java", "cpp", "c", "c_sharp", "csharp"].includes(language) ? child(node, "type") : language === "go" ? goResult(node) : null) ?? (arrow >= 0 ? node.children.slice(arrow + 1).find((item) => item.isNamed) ?? null : null);
  if (declared2 && /^(?::|->)?\s*&?\s*(?:mut\s+)?(?:this|Self|self|static)$/.test(text2(declared2).trim())) return "$self";
  return bareType(declared2);
}
function returnOf(node, language) {
  if (node.type === "return_statement" || node.type === "return_expression" || node.type === "return") {
    const value = node.namedChildren.find((item) => !isComment(item)) ?? null;
    if (value?.type === "expression_list") return value.namedChildren[0] ?? null;
    if (value?.type === "argument_list") return value.namedChildren.length === 1 ? value.namedChildren[0] : null;
    return value;
  }
  if (node.type === "arrow_function") {
    const body = child(node, "body");
    return body && body.type !== "statement_block" ? body : null;
  }
  if (language === "rust" && node.type === "block" && node.parent?.type === "function_item") {
    const last = node.namedChildren.filter((item) => !isComment(item)).at(-1);
    return last && !last.type.endsWith("_statement") && last.type !== "let_declaration" ? last : null;
  }
  return null;
}
function destructuredRequires(references, taken) {
  const modules = new Map(references.filter((item) => item.kind === "import" && item.imported_name === "*" && item.alias && !item.reexport).map((item) => [item.alias, item]));
  return taken.flatMap((node) => {
    const required = modules.get(text2(node.childForFieldName("value")));
    if (!required?.module) return [];
    const module = required.module;
    const record = (imported, alias) => makeReference("import", node, { name: module, reference: module, module, imported_name: imported, alias });
    return (node.childForFieldName("name")?.namedChildren ?? []).flatMap((item) => {
      if (item.type === "shorthand_property_identifier_pattern") return [record(text2(item), text2(item))];
      if (item.type === "pair_pattern") return [record(text2(item.childForFieldName("key")), text2(item.childForFieldName("value")))];
      return [];
    });
  });
}
var BASH_SOURCES = /* @__PURE__ */ new Set(["source", ".", "load"]);
var BASH_KEYWORDS = /* @__PURE__ */ new Set(["return", "exit", "break", "continue", "shift", "local", "declare", "typeset", "readonly", "export", "unset", "set", "true", "false", ":"]);
function bashLiteral(node) {
  if (node.type === "word") return node.text;
  if (node.type === "raw_string") return node.text.slice(1, -1);
  if (node.type !== "string") return null;
  return node.namedChildren.every((part) => part.type === "string_content") ? node.namedChildren.map((part) => part.text).join("") : null;
}
function bashCommand(node) {
  const name = child(node, "name");
  const word = name?.namedChildren.length === 1 && name.namedChildren[0].type === "word" ? name.namedChildren[0].text : null;
  if (word === null || BASH_KEYWORDS.has(word)) return [];
  if (!BASH_SOURCES.has(word)) return [callReferenceRecord(node, "bash")];
  const target = child(node, "argument");
  const module = target ? bashLiteral(target) : null;
  return module ? [makeReference("import", node, { name: module, reference: module, module, imported_name: "*", alias: "*" })] : [];
}
function referenceVisitor(language) {
  const references = [], taken = [];
  const enter = (node) => {
    if (isComment(node)) return;
    if (COMMONJS.has(language) && node.type === "variable_declarator" && child(node, "name")?.type === "object_pattern" && child(node, "value")?.type === "identifier") taken.push(node);
    const bases = basesOf(node);
    if (bases.length) {
      const name = node.type === "impl_item" ? implTypeName(node) ?? "" : isAnonymousClass(node) ? qualifiedScopeName(node) ?? "" : text2(child(node, "name"));
      if (name) for (const base of bases) references.push(makeReference("extends", node, { name, reference: base }));
    }
    const bindings = language === "go" ? goBindings(node) : [bindingOf(node, language) ?? parameterOf(node)].filter((item) => item !== null);
    if (language === "rust") {
      for (const binding of bindings) {
        const bound = binding.held.type && rustBound(node, binding.held.type);
        if (bound) binding.held = { ...binding.held, type: bound };
      }
      if (node.type === "field_declaration" && node.parent?.parent?.type === "struct_item") {
        const name = text2(child(node, "name")), type = bareType(child(node, "type"));
        if (name && type) bindings.push({ name: `this.${name}`, held: { type: rustBound(node, type) ?? rustImplBound(node.parent.parent, type) ?? type } });
      }
    }
    for (const binding of bindings) references.push(makeReference("bind", node, { name: binding.name, reference: binding.name, held: binding.held }));
    if (node.type === "property_promotion_parameter" && bindings[0]) {
      const name = `this.${bindings[0].name.replace(/^\$/, "")}`;
      references.push(makeReference("bind", node, { name, reference: name, held: bindings[0].held }));
    }
    const declared2 = declaredReturn(node, language);
    if (declared2) references.push({ ...makeReference("returns", node, { name: "return", reference: "return", held: { type: declared2 } }), source: `function:${node.startIndex}` });
    const returned = returnOf(node, language);
    if (returned) {
      const value = valueOf(returned, language);
      const owner = node.type === "arrow_function" ? node : node.type === "block" ? node.parent : null;
      if (value) references.push({
        ...makeReference("returns", returned, { name: "return", reference: "return", held: value }),
        ...owner ? { source: `function:${owner.startIndex}` } : {}
      });
    }
    if (language === "php" && node.type === "namespace_use_declaration") {
      references.push(...phpUseReferences(node));
    } else if (IMPORT_TYPES.has(node.type) || language === "kotlin" && node.type === "import_header") {
      if (language === "csharp" || language === "c_sharp") {
        const directive = csharpUsingReference(node);
        if (directive) references.push(directive);
      } else if (language === "swift") {
        const imported = swiftImportReference(node);
        if (imported) references.push(imported);
      } else if (language === "scala") references.push(...scalaImportReferences(node));
      else {
        if (language !== "kotlin") references.push(...importReferences(node, language));
        const binding = language === "java" || language === "kotlin" ? jvmImportReference(node, language) : null;
        if (binding) references.push(binding);
      }
    } else if (language === "php" && PHP_INCLUDES.has(node.type)) {
      references.push(...phpInclude(node));
    } else if (language === "ruby" && node.type === "call" && rubyRequire(node).length) {
      references.push(...rubyRequire(node));
    } else if (language === "lua" && node.type === "function_call" && luaRequire(node).length) {
      references.push(...luaRequire(node));
    } else if (language === "bash" && node.type === "command") {
      references.push(...bashCommand(node));
    } else if (language === "groovy" && node.type === "func") {
      const unit = node.parent, block = unit?.parent;
      if (block?.type === "block" && block.namedChildren[0]?.id === unit?.id && callableName(block)) return;
      const name = validReference(text2(node.namedChildren[0]));
      references.push(makeReference("call", node, { name, reference: name }));
    } else if (COMMONJS.has(language) && node.type === "export_statement" && node.childForFieldName("source")) {
      references.push(...reexportReferences(node));
    } else if (node.type === "using_declaration") {
      const named2 = node.namedChildren.find((item) => item.type === "identifier" || item.type === "namespace_identifier" || item.type === "qualified_identifier");
      const whole = node.children.some((item) => item.type === "namespace");
      if (named2) references.push(makeReference("import", node, { name: named2.text, reference: named2.text, module: named2.text, imported_name: whole ? "<namespace>" : "<using>" }));
    } else if (node.type === "declaration" && language === "cpp" && cppConstructed(node)) {
      const kind = cppConstructed(node);
      references.push(makeReference("call", node, { name: kind, reference: kind }));
    } else if (node.type === "modifier_invocation") {
      const name = validReference(text2(node.namedChildren.find((item) => item.type === "identifier")));
      if (name !== "<dynamic>") references.push(makeReference("call", node, { name, reference: name }));
    } else if (language === "zig" && node.type === "VarDecl") {
      const imported = zigImport(node, references.filter((item) => item.kind === "import"));
      if (imported) references.push(imported);
    } else if (language === "zig" && node.type === "SuffixExpr") {
      for (const item of zigChain(node).calls) references.push(makeReference("call", item.at, { name: item.reference, reference: item.reference, ...item.held ? { held: item.held } : {} }));
    } else if (node.type === "new_expression" || node.type === "object_creation_expression") {
      const kind = constructedType(node);
      if (kind) references.push(makeReference("call", node, { name: kind, reference: kind }));
    } else if (CALL_TYPES2.has(node.type) && isRequire(node, language)) {
      references.push(...requireReferences(node));
    } else if (CALL_TYPES2.has(node.type) && referenceBase(node)?.type === "import") {
      const module = stripModule(text2(child(node, "arguments")?.namedChildren[0] ?? null));
      references.push(makeReference("import", node, { name: module || "<unknown-module>", reference: module || "<unknown-module>", module: module || null }));
    } else if (CALL_TYPES2.has(node.type)) {
      references.push(callReferenceRecord(node, language));
    } else if (language === "rust" && node.type === "macro_invocation") {
      const name = validReference(text2(child(node, "macro") ?? node.namedChildren[0] ?? null, 128));
      if (name !== "<dynamic>" && !STD_MACROS.has(name)) references.push(makeReference("call", node, { name, reference: name }));
    } else if (language === "rust" && node.type === "token_tree") {
      references.push(...rustMacroCalls(node));
    } else if (node.type === "method_reference" || node.type === "callable_reference") {
      const name = methodReferenceName(node);
      if (name) references.push(makeReference("value", node, { name, reference: name }));
    } else if (IDENTIFIER_TYPES.has(node.type) && isPassedAsValue(node) && validReference(text2(node, 128))) {
      references.push(valueReference(node));
    } else if (isMemberRead(node)) {
      const name = validReference(text2(node, 128));
      if (name !== "<dynamic>") references.push(makeReference("read", node, { name, reference: name }));
      else if (language === "scala") {
        const split = memberOf(node, language);
        const held = split ? receiverOf(split.receiver, language) : null;
        if (split?.member && held) references.push(makeReference("read", node, { name: `$receiver.${split.member}`, reference: `$receiver.${split.member}`, held }));
      }
    }
  };
  return {
    enter,
    finish: (index) => {
      references.push(...destructuredRequires(references, taken));
      if (language === "cpp" || language === "c") unaliased(index, references);
      return references;
    }
  };
}

// src/treesitter/complexity.ts
var COMPLEXITY_LANGUAGES = /* @__PURE__ */ new Set([
  "c",
  "cpp",
  "go",
  "java",
  "javascript",
  "python",
  "rust",
  "typescript",
  "tsx"
]);
var CONTROL_NODE_TYPES = /* @__PURE__ */ new Set([
  "if_statement",
  "if_expression",
  "elif_clause",
  "for_statement",
  "for_expression",
  "for_in_statement",
  "for_range_loop",
  "for_in_clause",
  "foreach_statement",
  "enhanced_for_statement",
  "while_statement",
  "while_expression",
  "do_statement",
  "repeat_statement",
  "loop_statement",
  "loop_expression",
  "try_statement",
  "catch_clause",
  "except_clause",
  "conditional_expression",
  "ternary_expression",
  "switch_statement",
  "switch_expression",
  "expression_switch_statement",
  "type_switch_statement",
  "select_statement",
  "match_expression",
  "match_statement",
  "case_statement",
  "type_case",
  "switch_case",
  "switch_label",
  "expression_case",
  "default_case",
  "case_clause",
  "switch_default",
  "match_arm",
  "when_entry",
  "communication_case",
  "if_clause"
]);
var DECISION_NODE_TYPES = /* @__PURE__ */ new Set([
  "if_statement",
  "if_expression",
  "elif_clause",
  "for_statement",
  "for_expression",
  "for_in_statement",
  "for_range_loop",
  "for_in_clause",
  "foreach_statement",
  "enhanced_for_statement",
  "while_statement",
  "while_expression",
  "do_statement",
  "repeat_statement",
  "catch_clause",
  "except_clause",
  "conditional_expression",
  "ternary_expression",
  "if_clause"
]);
var ARM_NODE_TYPES = /* @__PURE__ */ new Set([
  "case_statement",
  "type_case",
  "switch_case",
  "switch_label",
  "expression_case",
  "default_case",
  "case_clause",
  "switch_default",
  "match_arm",
  "when_entry",
  "communication_case"
]);
var LOGICAL_NODE_TYPES = /* @__PURE__ */ new Set([
  "boolean_operator",
  "binary_expression",
  "binary_operator",
  "logical_expression",
  "infix_expression"
]);
var LOGICAL_OPERATORS = /* @__PURE__ */ new Set(["and", "or", "&&", "||", "??"]);
var BRANCH_LABELS = {
  if_statement: "if",
  if_expression: "if",
  elif_clause: "elif",
  for_statement: "for",
  for_expression: "for",
  for_in_statement: "for-in",
  for_range_loop: "for-range",
  for_in_clause: "for-in",
  foreach_statement: "foreach",
  enhanced_for_statement: "for-each",
  while_statement: "while",
  while_expression: "while",
  do_statement: "do-while",
  repeat_statement: "repeat",
  loop_statement: "loop",
  loop_expression: "loop",
  try_statement: "try",
  catch_clause: "catch",
  except_clause: "except",
  conditional_expression: "conditional",
  ternary_expression: "ternary",
  switch_statement: "switch",
  switch_expression: "switch",
  expression_switch_statement: "switch",
  type_switch_statement: "type-switch",
  select_statement: "select",
  match_expression: "match",
  match_statement: "match",
  case_statement: "case",
  type_case: "case",
  switch_case: "case",
  switch_label: "case",
  expression_case: "case",
  default_case: "default",
  case_clause: "case",
  switch_default: "default",
  match_arm: "arm",
  when_entry: "when",
  communication_case: "case",
  if_clause: "if"
};
function unsupported() {
  return {
    complexity_status: "unsupported",
    complexity_adapter: null,
    cyclomatic_complexity: null,
    control_branch_count: null,
    logical_branch_count: null,
    max_nesting: null,
    structure_hotspots: [],
    branch_lines: []
  };
}
function nodeText(node) {
  return node?.text.trim() ?? "";
}
function operatorText(node) {
  const operator = node.childForFieldName("operator");
  if (operator) return nodeText(operator);
  for (let index = 0; index < node.childCount; index += 1) {
    const child2 = node.child(index);
    if (child2 && !child2.isNamed && LOGICAL_OPERATORS.has(nodeText(child2))) {
      return nodeText(child2);
    }
  }
  return "";
}
function isLogical(node) {
  return LOGICAL_NODE_TYPES.has(node.type) && LOGICAL_OPERATORS.has(operatorText(node));
}
function isElseIf(node) {
  if (node.type === "elif_clause") {
    return node.parent?.type === "if_statement" || node.parent?.type === "elif_clause";
  }
  if (node.type !== "if_statement" && node.type !== "if_expression") return false;
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "else_clause") return true;
  if (parent.type !== "if_statement" && parent.type !== "if_expression") return false;
  const alternative = parent.childForFieldName("alternative");
  return alternative?.id === node.id;
}
function isDefaultArm(node) {
  if (node.type === "default_case" || node.type === "switch_default") return true;
  const text3 = nodeText(node).replace(/^\s+/u, "");
  if (node.type === "match_arm") {
    const pattern = node.childForFieldName("pattern");
    return nodeText(pattern).split("=>", 1)[0].trim() === "_";
  }
  if (node.type === "case_clause" && !node.childForFieldName("guard")) {
    const patterns = node.namedChildren.filter((child2) => child2.type === "case_pattern");
    return patterns.length === 1 && nodeText(patterns[0]) === "_";
  }
  if (node.type === "switch_label" && nodeText(node.child(node.childCount - 1)) === "default") return true;
  return text3.startsWith("default");
}
function countsAsDecision(node) {
  return DECISION_NODE_TYPES.has(node.type) || ARM_NODE_TYPES.has(node.type) && !isDefaultArm(node);
}
function hasMatchGuard(node) {
  if (node.type !== "match_arm") return false;
  const pattern = node.childForFieldName("pattern");
  return pattern?.childForFieldName("condition") != null;
}
function effectiveAncestorsFor(node, ancestors2, branches) {
  const previous = ancestors2.at(-1);
  const isConditional = node.type === "if_statement" || node.type === "if_expression" || node.type === "elif_clause";
  const previousIsConditional = previous !== void 0 && branches[previous]?.node_type !== void 0 && ["if_statement", "if_expression", "elif_clause"].includes(branches[previous].node_type);
  return previousIsConditional && isConditional && isElseIf(node) ? ancestors2.slice(0, -1) : ancestors2;
}
function addBranch(node, ancestors2, branches) {
  if (!CONTROL_NODE_TYPES.has(node.type)) {
    return { ancestors: ancestors2, decisions: 0, nesting: 0 };
  }
  const index = branches.length;
  const nesting = ancestors2.length + 1;
  const counts = countsAsDecision(node);
  const guard = hasMatchGuard(node) ? 1 : 0;
  const decisions = (counts ? 1 : 0) + guard;
  const hotspot = {
    index,
    type: BRANCH_LABELS[node.type] ?? node.type,
    node_type: node.type,
    line: node.startPosition.row + 1,
    end_line: Math.max(
      node.startPosition.row + 1,
      node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0)
    ),
    nesting,
    counts_toward_cyclomatic: counts,
    guard_branches: guard,
    subtree_branches: decisions,
    subtree_control_nodes: 1,
    subtree_logical_branches: 0,
    subtree_max_nesting: nesting
  };
  branches.push(hotspot);
  for (const parent of ancestors2) {
    branches[parent].subtree_branches += decisions;
    branches[parent].subtree_control_nodes += 1;
    branches[parent].subtree_max_nesting = Math.max(
      branches[parent].subtree_max_nesting,
      nesting
    );
  }
  return { ancestors: [...ancestors2, index], decisions, nesting };
}
function addLogicalBranch(node, ancestors2, branches) {
  if (!isLogical(node)) return 0;
  for (const parent of ancestors2) {
    branches[parent].subtree_logical_branches += 1;
  }
  return 1;
}
function hotspotComparator(left, right) {
  return right.subtree_branches - left.subtree_branches || right.subtree_logical_branches - left.subtree_logical_branches || right.subtree_control_nodes - left.subtree_control_nodes || right.nesting - left.nesting || left.line - right.line || left.end_line - right.end_line;
}
function measureComplexity(root, language, excludeNested = false, index = walk(root)) {
  if (!COMPLEXITY_LANGUAGES.has(language)) return unsupported();
  const branches = [];
  let logicalCount = 0;
  let decisionCount = 0;
  let maxNesting = 0;
  const frames = [];
  const all = index.all, stop = index.end(root);
  for (let at = index.at(root); at < stop; ) {
    const node = all[at];
    while (frames.length && frames[frames.length - 1].end <= at) frames.pop();
    if (node !== root && excludeNested && isFunction(node)) {
      at = index.end(node);
      continue;
    }
    const ancestors2 = frames.length ? frames[frames.length - 1].ancestors : [];
    const effectiveAncestors = effectiveAncestorsFor(node, ancestors2, branches);
    const branch = addBranch(node, effectiveAncestors, branches);
    decisionCount += branch.decisions;
    maxNesting = Math.max(maxNesting, branch.nesting);
    logicalCount += addLogicalBranch(node, effectiveAncestors, branches);
    frames.push({ end: index.end(node), ancestors: branch.ancestors });
    at += 1;
  }
  const branch_lines = [...new Set(branches.map((branch) => branch.line))].sort((a, b) => a - b);
  const structure_hotspots = branches.sort(hotspotComparator).slice(0, 24).map(({ index: _index, ...hotspot }) => hotspot);
  return {
    complexity_status: "supported",
    complexity_adapter: "core-tree-sitter-v1",
    cyclomatic_complexity: 1 + decisionCount + logicalCount,
    control_branch_count: decisionCount,
    logical_branch_count: logicalCount,
    max_nesting: maxNesting,
    structure_hotspots,
    branch_lines
  };
}

// src/treesitter/tests/go.ts
function testingType(type, kind) {
  if (type?.type !== "pointer_type") return false;
  const qualified = type.namedChildren[0];
  return qualified?.type === "qualified_type" && qualified.childForFieldName("package")?.text === "testing" && qualified.childForFieldName("name")?.text === kind;
}
function testingParameter(fn) {
  const parameters = fn.childForFieldName("parameters")?.namedChildren.filter((item) => item.type === "parameter_declaration") ?? [];
  if (parameters.length !== 1 || fn.childForFieldName("parameters")?.namedChildren.length !== 1) return null;
  const names2 = parameters[0].namedChildren.filter((item) => item.type === "identifier");
  return names2.length === 1 && testingType(parameters[0].childForFieldName("type"), "T") ? names2[0].text : null;
}
var TEST_NAME = /^Test(?:$|[^a-z])/;
function receiverType(method) {
  const receiver = method.childForFieldName("receiver")?.namedChildren.find((item) => item.type === "parameter_declaration");
  let type = receiver?.childForFieldName("type") ?? null;
  if (type?.type === "pointer_type") type = type.namedChildren[0] ?? null;
  return type?.type === "type_identifier" ? type.text : null;
}
function testifySuites(index) {
  const suites = /* @__PURE__ */ new Set();
  for (const spec of index.of("type_spec")) {
    const struct = spec.childForFieldName("type");
    const name = spec.childForFieldName("name");
    if (struct?.type !== "struct_type" || !name) continue;
    const fields = struct.namedChildren.find((item) => item.type === "field_declaration_list")?.namedChildren ?? [];
    const embedded = fields.some((field) => field.type === "field_declaration" && !field.childForFieldName("name") && field.childForFieldName("type")?.type === "qualified_type" && field.childForFieldName("type").childForFieldName("package")?.text === "suite" && field.childForFieldName("type").childForFieldName("name")?.text === "Suite");
    if (embedded) suites.add(name.text);
  }
  return suites;
}
var TESTIFY_SETUP = ["SetupSuite", "SetupTest", "BeforeTest"];
function enclosingCase(node, scan) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!isFunction(parent)) continue;
    const found = scan.cases.get(span(parent));
    if (found) return { node: parent, found };
  }
  return null;
}
function goTests(index, scan, path) {
  void path;
  for (const node of index.of("function_declaration")) {
    const name = node.childForFieldName("name")?.text ?? "";
    if (!TEST_NAME.test(name) || !testingParameter(node)) continue;
    scan.cases.set(span(node), { test: { name, suite: [], framework: "testing" }, qualified: null });
  }
  const suites = testifySuites(index);
  if (suites.size) {
    const methods = index.of("method_declaration").filter((node) => node.type === "method_declaration");
    const methodsOf2 = (type) => methods.filter((node) => receiverType(node) === type).map((node) => node.childForFieldName("name")?.text ?? "");
    for (const node of methods) {
      const type = receiverType(node), name = node.childForFieldName("name")?.text ?? "";
      if (!type || !suites.has(type) || !TEST_NAME.test(name)) continue;
      const declared2 = methodsOf2(type);
      const setup = TESTIFY_SETUP.filter((hook) => declared2.includes(hook)).map((hook) => `${type}.${hook}`);
      scan.cases.set(span(node), { test: { name, suite: [type], framework: "testify", ...setup.length ? { setup } : {} }, qualified: null });
    }
  }
  for (const node of index.of("call_expression")) {
    const callee = node.childForFieldName("function");
    if (callee?.type !== "selector_expression" || callee.childForFieldName("field")?.text !== "Run") continue;
    const receiver = callee.childForFieldName("operand");
    const args = (node.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => !arg.type.includes("comment"));
    const body = args[1];
    if (receiver?.type !== "identifier" || args.length !== 2 || body?.type !== "func_literal" || !testingParameter(body)) continue;
    const parent = enclosingCase(node, scan);
    if (!parent || testingParameter(parent.node) !== receiver.text) continue;
    const written = literal(args[0]);
    const name = written ?? computedTitle(args[0]).replace(/\s+/g, " ").slice(0, 120);
    const parametrized = written === null || parent.found.test.parametrized === true;
    const suite = [...parent.found.test.suite, parent.found.test.name];
    const qualified = `${parent.found.qualified ?? parent.found.test.name}/${name}`;
    scan.cases.set(span(body), { test: { name, suite, framework: parent.found.test.framework, ...parametrized ? { parametrized: true } : {} }, qualified });
  }
}

// src/treesitter/tests/c.ts
var identifierArgs = (args) => args.filter((arg) => arg.type === "identifier").map((arg) => arg.text);
function callOf(node) {
  if (node.type !== "call_expression") return null;
  const callee = node.childForFieldName("function");
  if (callee?.type !== "identifier") return null;
  return { name: callee.text, arguments: (node.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => !arg.type.includes("comment")) };
}
function definedName(node) {
  let declarator = node.childForFieldName("declarator");
  while (declarator && declarator.type !== "function_declarator") declarator = declarator.childForFieldName("declarator") ?? declarator.namedChildren[0] ?? null;
  const name = declarator?.childForFieldName("declarator");
  return name?.type === "identifier" ? name.text : null;
}
function definitions(index) {
  const defined = /* @__PURE__ */ new Map();
  for (const node of index.of("function_definition")) {
    if (node.type !== "function_definition") continue;
    const name = definedName(node);
    if (name && !defined.has(name)) defined.set(name, node);
  }
  return defined;
}
function assignedFrom(index, functions) {
  const values = /* @__PURE__ */ new Map();
  for (const node of index.of("init_declarator", "assignment_expression")) {
    const value = node.type === "init_declarator" ? node.childForFieldName("value") : node.childForFieldName("right");
    const call = value ? callOf(value) : null;
    if (!call || !functions.has(call.name)) continue;
    let name = node.type === "init_declarator" ? node.childForFieldName("declarator") : node.childForFieldName("left");
    while (name && name.type === "pointer_declarator") name = name.childForFieldName("declarator");
    if (name?.type === "identifier") values.set(name.text, call.arguments);
  }
  return values;
}
var CHECK_ADD = /^tcase_add_(?:test|loop_test|exit_test|test_raise_signal|loop_exit_test|loop_test_raise_signal)$/;
var CHECK_FIXTURE = /* @__PURE__ */ new Set(["tcase_add_checked_fixture", "tcase_add_unchecked_fixture"]);
function checkTestName(node) {
  const type = node.childForFieldName("type"), declarator = node.childForFieldName("declarator");
  if (type?.type !== "type_identifier" || !declarator) return null;
  if (type.text === "START_TEST" && declarator.type === "parenthesized_declarator") {
    const name = declarator.namedChildren[0];
    return name?.type === "identifier" ? name.text : null;
  }
  if (type.text === "END_TEST" && declarator.type === "function_declarator" && declarator.childForFieldName("declarator")?.text === "START_TEST") {
    const parameters = declarator.childForFieldName("parameters")?.namedChildren.filter((item) => item.type === "parameter_declaration") ?? [];
    const name = parameters.length === 1 ? parameters[0].childForFieldName("type") : null;
    return name?.type === "type_identifier" && !parameters[0].childForFieldName("declarator") ? name.text : null;
  }
  return null;
}
function checkTests(index, scan) {
  const tcaseOf = /* @__PURE__ */ new Map(), suiteOf = /* @__PURE__ */ new Map(), fixtureOf = /* @__PURE__ */ new Map();
  for (const node of index.of("call_expression")) {
    const call = callOf(node);
    if (!call) continue;
    const args = identifierArgs(call.arguments);
    if (CHECK_ADD.test(call.name) && call.arguments[0]?.type === "identifier" && call.arguments[1]?.type === "identifier") tcaseOf.set(args[1], args[0]);
    else if (call.name === "suite_add_tcase" && args.length >= 2) suiteOf.set(args[1], args[0]);
    else if (CHECK_FIXTURE.has(call.name) && call.arguments[0]?.type === "identifier") {
      const setup = call.arguments[1]?.type === "identifier" ? [call.arguments[1].text] : [];
      fixtureOf.set(args[0], [...fixtureOf.get(args[0]) ?? [], ...setup]);
    }
  }
  const created = assignedFrom(index, /* @__PURE__ */ new Set(["suite_create", "tcase_create"]));
  const titled3 = (variable) => variable ? literal(created.get(variable)?.[0]) : null;
  for (const node of index.of("function_definition")) {
    if (node.type !== "function_definition") continue;
    const name = checkTestName(node);
    if (!name) continue;
    const tcase = tcaseOf.get(name);
    const suite = [titled3(suiteOf.get(tcase ?? "")), titled3(tcase)].filter((part) => part !== null);
    const setup = tcase ? fixtureOf.get(tcase) ?? [] : [];
    scan.cases.set(span(node), { test: { name, suite, framework: "check", ...setup.length ? { setup } : {} }, qualified: name });
  }
}
var CMOCKA_UNIT = /^cmocka_unit_test(?:_setup|_teardown|_setup_teardown|_prestate|_prestate_setup_teardown)?$/;
function cmockaTests(index, scan) {
  const groups = /* @__PURE__ */ new Map();
  for (const node of index.of("call_expression")) {
    const call = callOf(node);
    if (call?.name === "cmocka_run_group_tests" && call.arguments[0]?.type === "identifier") {
      groups.set(call.arguments[0].text, { name: call.arguments[0].text, setup: call.arguments[1]?.type === "identifier" ? call.arguments[1].text : null });
    } else if (call?.name === "cmocka_run_group_tests_name" && call.arguments[1]?.type === "identifier") {
      groups.set(call.arguments[1].text, { name: literal(call.arguments[0]), setup: call.arguments[2]?.type === "identifier" ? call.arguments[2].text : null });
    }
  }
  const defined = definitions(index);
  for (const node of index.of("call_expression")) {
    const call = callOf(node);
    if (!call || !CMOCKA_UNIT.test(call.name) || call.arguments[0]?.type !== "identifier") continue;
    const fn = defined.get(call.arguments[0].text);
    if (!fn) continue;
    let holder = node.parent;
    while (holder && holder.type !== "initializer_list") holder = holder.parent;
    let declared2 = holder?.parent?.type === "init_declarator" ? holder.parent.childForFieldName("declarator") : null;
    while (declared2 && declared2.type !== "identifier") declared2 = declared2.childForFieldName("declarator") ?? declared2.namedChildren[0] ?? null;
    const group = declared2 ? groups.get(declared2.text) : void 0;
    const setup = [group?.setup ?? null, /_setup/.test(call.name) && call.arguments[1]?.type === "identifier" ? call.arguments[1].text : null].filter((item) => item !== null);
    const name = call.arguments[0].text;
    scan.cases.set(span(fn), { test: { name, suite: group?.name ? [group.name] : [], framework: "cmocka", ...setup.length ? { setup } : {} }, qualified: null });
  }
}
var CRITERION_TESTS = /* @__PURE__ */ new Set(["Test", "ParameterizedTest"]);
function designated(index, args, field) {
  for (const arg of args) {
    for (const node of index.within(arg)) {
      if (node.type !== "assignment_expression") continue;
      const left = node.childForFieldName("left"), right = node.childForFieldName("right");
      const named2 = left?.type === "identifier" ? left.text : left?.type === "field_expression" ? left.childForFieldName("field")?.text : null;
      if (named2 === field && right?.type === "identifier") return right.text;
    }
  }
  return null;
}
function criterionTests(index, scan) {
  const suiteSetup = /* @__PURE__ */ new Map();
  for (const node of index.of("call_expression")) {
    const call = callOf(node);
    if (call?.name !== "TestSuite" || !call.arguments.length) continue;
    const suite = index.within(call.arguments[0]).find((item) => item.type === "identifier")?.text;
    const init = designated(index, call.arguments, "init");
    if (suite && init) suiteSetup.set(suite, init);
  }
  if (!scan.blockMacros.size) scan.blockMacros = /* @__PURE__ */ new Set([...CRITERION_TESTS, "TestSuite"]);
  for (const scope of index.of("translation_unit")) {
    const items = scope.namedChildren.filter((item) => !item.type.includes("comment"));
    for (const [at, item] of items.entries()) {
      const macro = macroCall(item);
      const body = items[at + 1];
      if (!macro || !CRITERION_TESTS.has(macro.name) || body?.type !== "compound_statement") continue;
      const [suite, name] = identifierArgs(macro.arguments).slice(-2);
      if (!suite || !name) continue;
      const setup = [suiteSetup.get(suite) ?? null, designated(index, macro.arguments, "init")].filter((item2) => item2 !== null);
      scan.bodies.push(body);
      scan.cases.set(span(body), { test: { name, suite: [suite], framework: "criterion", ...setup.length ? { setup } : {}, ...macro.name === "Test" ? {} : { parametrized: true } }, qualified: `${suite}.${name}` });
    }
  }
}
function unityTests(index, scan) {
  const defined = definitions(index);
  const setup = defined.has("setUp") ? ["setUp"] : [];
  for (const node of index.of("call_expression")) {
    const call = callOf(node);
    if (call?.name !== "RUN_TEST" || call.arguments[0]?.type !== "identifier") continue;
    const fn = defined.get(call.arguments[0].text);
    if (fn) scan.cases.set(span(fn), { test: { name: call.arguments[0].text, suite: [], framework: "unity", ...setup.length ? { setup } : {} }, qualified: null });
  }
}
function cTests(index, scan, path) {
  void path;
  const headers = includedHeaders(index);
  const includes = (name) => headers.some((header) => name.test(header));
  if (includes(/(^|\/)check\.h$/)) checkTests(index, scan);
  if (includes(/(^|\/)cmocka\.h$/)) cmockaTests(index, scan);
  if (includes(/(^|\/)criterion\/[\w/]+\.h$/)) criterionTests(index, scan);
  if (includes(/(^|\/)unity(?:_fixture)?\.h$/)) unityTests(index, scan);
}

// src/treesitter/tests/c_sharp.ts
var FRAMEWORKS = {
  xunit: { tests: /* @__PURE__ */ new Set(["Fact", "Theory"]), parametrized: /* @__PURE__ */ new Set(["Theory"]), setup: /* @__PURE__ */ new Set() },
  nunit: {
    tests: /* @__PURE__ */ new Set(["Test", "TestCase", "TestCaseSource", "Theory", "Combinatorial", "Pairwise", "Sequential"]),
    parametrized: /* @__PURE__ */ new Set(["TestCase", "TestCaseSource", "Theory", "Combinatorial", "Pairwise", "Sequential"]),
    setup: /* @__PURE__ */ new Set(["SetUp", "OneTimeSetUp"])
  },
  mstest: { tests: /* @__PURE__ */ new Set(["TestMethod", "DataTestMethod"]), parametrized: /* @__PURE__ */ new Set(["DataTestMethod"]), setup: /* @__PURE__ */ new Set(["TestInitialize", "ClassInitialize"]) }
};
var DATA_ROWS = /* @__PURE__ */ new Set(["TestCase", "TestCaseSource", "Values", "ValueSource", "Range", "Random", "DataRow", "DynamicData"]);
var CLASSES = /* @__PURE__ */ new Set(["class_declaration", "struct_declaration", "record_declaration"]);
function attributes(node) {
  const found = [];
  for (const list of node.namedChildren.filter((child2) => child2.type === "attribute_list")) {
    for (const attribute of list.namedChildren.filter((child2) => child2.type === "attribute")) {
      const name = attribute.childForFieldName("name");
      const last = name?.type === "qualified_name" ? name.childForFieldName("name") : name;
      if (last) found.push(last.text.replace(/Attribute$/, ""));
    }
  }
  return found;
}
function frameworkOf(names2, usings) {
  const claimed = Object.keys(FRAMEWORKS).filter((framework) => names2.some((name) => FRAMEWORKS[framework].tests.has(name)));
  if (!claimed.length) return null;
  if (claimed.length === 1) return claimed[0];
  const unique = claimed.filter((framework) => names2.some((name) => FRAMEWORKS[framework].tests.has(name) && !Object.keys(FRAMEWORKS).some((other) => other !== framework && FRAMEWORKS[other].tests.has(name))));
  if (unique.length === 1) return unique[0];
  if (usings.has("Xunit") && !usings.has("NUnit.Framework")) return "xunit";
  if (usings.has("NUnit.Framework") && !usings.has("Xunit")) return "nunit";
  return claimed[0];
}
function usingsOf(index) {
  const names2 = /* @__PURE__ */ new Set();
  for (const node of index.of("using_directive")) {
    const path = node.namedChildren.find((child2) => child2.type === "qualified_name" || child2.type === "identifier");
    if (path && !node.childForFieldName("name")) names2.add(path.text);
  }
  return names2;
}
function setupOf(node, framework) {
  const setup = [];
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!CLASSES.has(scope.type)) continue;
    const owner = scope.childForFieldName("name")?.text;
    if (!owner) continue;
    const members = scope.childForFieldName("body")?.namedChildren ?? [];
    if (framework === "xunit" && members.some((item) => item.type === "constructor_declaration")) setup.push(`${owner}.${owner}`);
    for (const item of members) {
      if (item.type !== "method_declaration") continue;
      const name = item.childForFieldName("name")?.text;
      if (name && (attributes(item).some((marker) => FRAMEWORKS[framework].setup.has(marker)) || framework === "xunit" && name === "InitializeAsync")) setup.push(`${owner}.${name}`);
    }
  }
  return setup;
}
function csharpTests(index, scan, path) {
  void path;
  const usings = usingsOf(index);
  const className2 = (scope) => scope.childForFieldName("name")?.text ?? null;
  for (const node of index.of("method_declaration")) {
    if (node.type !== "method_declaration") continue;
    const names2 = attributes(node);
    const framework = frameworkOf(names2, usings);
    if (!framework) continue;
    const name = node.childForFieldName("name")?.text ?? "";
    const setup = setupOf(node, framework);
    const parametrized = names2.some((item) => FRAMEWORKS[framework].parametrized.has(item) || DATA_ROWS.has(item));
    scan.cases.set(span(node), { test: { name, suite: enclosing(node, CLASSES, className2), framework, ...parametrized ? { parametrized: true } : {}, ...setup.length ? { setup } : {} }, qualified: null });
  }
}

// src/treesitter/tests/ruby.ts
var SUITES = /* @__PURE__ */ new Set(["describe", "context", "feature", "shared_examples", "shared_examples_for", "shared_context"]);
var TESTS = /* @__PURE__ */ new Set(["it", "specify", "example", "scenario"]);
var BLOCKS = /* @__PURE__ */ new Set(["do_block", "block"]);
var SCOPES = /* @__PURE__ */ new Set(["class", "module"]);
var scopeName2 = (scope) => scope.childForFieldName("name")?.text ?? null;
function callParts(call) {
  if (call.type !== "call") return null;
  const method = call.childForFieldName("method");
  if (method?.type !== "identifier") return null;
  const receiver = call.childForFieldName("receiver");
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => arg.type !== "comment");
  const block = call.childForFieldName("block");
  return { method: method.text, receiver: receiver ? receiver.text : null, args, block: block && BLOCKS.has(block.type) ? block : null };
}
function description(args) {
  const parts = [];
  for (const arg of args) {
    const written = literal(arg) ?? (["constant", "scope_resolution"].includes(arg.type) ? arg.text : arg.type === "simple_symbol" ? arg.text.slice(1) : null);
    if (written === null) break;
    parts.push(written);
  }
  if (!parts.length) return null;
  return parts.reduce((whole, part) => /^[#.]/.test(part) ? `${whole}${part}` : `${whole} ${part}`);
}
function specFramework(index) {
  for (const call of index.of("call")) {
    const parts = callParts(call);
    if (!parts || parts.method !== "require" || parts.receiver) continue;
    const required = literal(parts.args[0]);
    if (required && (/^minitest\b/.test(required) || required === "test_helper")) return "minitest";
    if (required && (/^rspec\b/.test(required) || /^(?:spec|rails)_helper$/.test(required))) return "rspec";
  }
  return "rspec";
}
function testClass(node) {
  if (node.type !== "class") return null;
  const base = node.childForFieldName("superclass")?.namedChildren.find((child2) => ["constant", "scope_resolution"].includes(child2.type));
  if (!base) return null;
  const written = base.text, last = written.split("::").at(-1) ?? "";
  if (/^(?:::)?Test::Unit::TestCase$/.test(written)) return "test-unit";
  return /(?:TestCase|Test|Spec)$/.test(last) ? "minitest" : null;
}
function suitesAround(node) {
  const suite = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (SCOPES.has(parent.type)) {
      const name = scopeName2(parent);
      if (name) suite.unshift(name);
    }
    if (!BLOCKS.has(parent.type) || parent.parent?.type !== "call") continue;
    const outer = callParts(parent.parent);
    if (outer?.block?.id === parent.id && SUITES.has(outer.method)) suite.unshift(description(outer.args) ?? "");
  }
  return suite;
}
function rubyTests(index, scan, path) {
  const framework = specFramework(index);
  for (const node of index.of("class")) {
    const kind = testClass(node);
    const body = node.childForFieldName("body");
    if (!kind || !body) continue;
    const owner = [...enclosing(node, SCOPES, scopeName2), scopeName2(node) ?? ""].filter(Boolean);
    const suite = owner;
    scan.suites.push({ start: body.startIndex, end: body.endIndex });
    const methods = body.namedChildren.filter((item) => item.type === "method");
    const setup = methods.filter((item) => ["setup", "before_setup"].includes(item.childForFieldName("name")?.text ?? "")).map((item) => `${owner.join(".")}.${item.childForFieldName("name").text}`);
    const fixed = setup.length ? { setup } : {};
    for (const method of methods) {
      const name = method.childForFieldName("name")?.text ?? "";
      if (name.startsWith("test_")) scan.cases.set(span(method), { test: { name, suite, framework: kind, ...fixed }, qualified: null });
    }
    for (const item of body.namedChildren) {
      const parts = callParts(item);
      const title = parts && parts.method === "test" && !parts.receiver ? literal(parts.args[0]) : null;
      if (title === null || !parts?.block) continue;
      scan.bodies.push(parts.block);
      const generated = `test_${title.replace(/\s+/g, "_")}`;
      scan.cases.set(span(parts.block), { test: { name: title, suite, framework: kind, ...fixed }, qualified: [...owner, generated].join(".") });
    }
  }
  for (const node of index.of("call")) {
    const parts = callParts(node);
    if (!parts?.block) continue;
    if (SUITES.has(parts.method) && (parts.receiver === null || parts.receiver === "RSpec")) {
      scan.suites.push({ start: parts.block.startIndex, end: parts.block.endIndex });
      continue;
    }
    if (!TESTS.has(parts.method) || parts.receiver !== null) continue;
    const suite = suitesAround(node);
    if (!suite.length) continue;
    const title = description(parts.args) ?? `example at ${path ?? "<unknown>"}:${lineOf(node)}`;
    scan.bodies.push(parts.block);
    scan.cases.set(span(parts.block), { test: { name: title, suite, framework }, qualified: [...suite, title].join(" > ") });
  }
  rubyMocks(index, scan);
}
var VERIFYING_DOUBLES = /* @__PURE__ */ new Set(["instance_double", "class_double", "object_double", "instance_spy", "class_spy"]);
var STUBBING = /* @__PURE__ */ new Set(["allow", "expect", "allow_any_instance_of", "expect_any_instance_of"]);
function rubyMockTarget(call) {
  const parts = callParts(call);
  if (!parts) return null;
  if (parts.receiver === null && VERIFYING_DOUBLES.has(parts.method)) {
    const named2 = parts.args[0];
    return named2 && ["constant", "scope_resolution"].includes(named2.type) ? { kind: "class", name: named2.text.split("::").at(-1) } : null;
  }
  if (parts.method === "to" || parts.method === "not_to" || parts.method === "to_not") {
    const receiver = call.childForFieldName("receiver");
    const stubbed = receiver ? callParts(receiver) : null;
    let chain = parts.args[0] ?? null, matcher = chain ? callParts(chain) : null;
    while (chain && matcher && matcher.method !== "receive") {
      if (matcher.method === "and_call_original") return null;
      chain = chain.childForFieldName("receiver");
      matcher = chain ? callParts(chain) : null;
    }
    if (!stubbed || stubbed.receiver !== null || !STUBBING.has(stubbed.method) || matcher?.method !== "receive" || matcher.receiver !== null) return null;
    const object = stubbed.args[0], name = matcher.args[0];
    return object && ["constant", "scope_resolution", "identifier", "instance_variable"].includes(object.type) && name?.type === "simple_symbol" ? { kind: "member", object: object.text.replace(/^@/, "this."), name: name.text.slice(1) } : null;
  }
  if (parts.method === "stub" && parts.receiver !== null && parts.args[0]?.type === "simple_symbol") {
    const receiver = call.childForFieldName("receiver");
    return ["constant", "scope_resolution", "identifier", "instance_variable"].includes(receiver.type) ? { kind: "member", object: receiver.text.replace(/^@/, "this."), name: parts.args[0].text.slice(1) } : null;
  }
  return null;
}
function rubyMocks(index, scan) {
  for (const node of index.of("call")) {
    const target = rubyMockTarget(node);
    if (target) scan.mocks.push({ owner: ownerIn(node, scan), target, line: lineOf(node) });
  }
}

// src/treesitter/tests/php.ts
var CLASSES2 = /* @__PURE__ */ new Set(["class_declaration"]);
var className = (scope) => scope.childForFieldName("name")?.text ?? null;
var lastName = (node) => node?.text.split("\\").at(-1) ?? "";
function phpunitClass(node) {
  const bases = node.namedChildren.find((child2) => child2.type === "base_clause")?.namedChildren ?? [];
  return bases.some((base) => /(?:TestCase|Test)$/.test(lastName(base)));
}
function attributes2(node) {
  const list = node.childForFieldName("attributes");
  return (list ? [...list.namedChildren.flatMap((group) => group.namedChildren)] : []).filter((attribute) => attribute.type === "attribute").map((attribute) => lastName(attribute.namedChildren[0]));
}
function docblock(node) {
  const siblings = node.parent?.namedChildren ?? [];
  const at = siblings.findIndex((item) => item.id === node.id);
  const before = at > 0 ? siblings[at - 1] : null;
  if (before?.type !== "comment" || !before.text.startsWith("/**")) return [];
  return before.text.split(/\s+/).filter((word) => word.startsWith("@")).map((word) => word.slice(1));
}
var PROVIDERS = /* @__PURE__ */ new Set(["DataProvider", "DataProviderExternal", "TestWith", "TestWithJson"]);
var PROVIDER_TAGS = /* @__PURE__ */ new Set(["dataProvider", "testWith"]);
function phpunitTests(index, scan) {
  for (const node of index.of("class_declaration")) {
    if (!phpunitClass(node)) continue;
    const body = node.childForFieldName("body");
    const methods = body?.namedChildren.filter((item) => item.type === "method_declaration") ?? [];
    const suite = [...enclosing(node, CLASSES2, className), className(node) ?? ""].filter(Boolean);
    const owner = suite.join(".");
    const setup = methods.map((method) => method.childForFieldName("name")?.text ?? "").filter((name) => name === "setUp" || name === "setUpBeforeClass").map((name) => `${owner}.${name}`);
    for (const method of methods) {
      const name = method.childForFieldName("name")?.text ?? "";
      const marked = attributes2(method), tagged = docblock(method);
      if (!name.startsWith("test") && !marked.includes("Test") && !tagged.includes("test")) continue;
      if (/^(?:setUp|tearDown)/.test(name)) continue;
      const parametrized = marked.some((item) => PROVIDERS.has(item)) || tagged.some((item) => PROVIDER_TAGS.has(item));
      scan.cases.set(span(method), { test: { name, suite, framework: "phpunit", ...setup.length ? { setup } : {}, ...parametrized ? { parametrized: true } : {} }, qualified: null });
    }
  }
}
var PEST_TESTS = /* @__PURE__ */ new Set(["it", "test"]);
var PEST_SUITES = /* @__PURE__ */ new Set(["describe"]);
var PEST_HOOKS = /* @__PURE__ */ new Set(["beforeEach", "beforeAll", "afterEach", "afterAll"]);
var CLOSURES = /* @__PURE__ */ new Set(["anonymous_function", "arrow_function"]);
function pestRole(call) {
  if (call.type !== "function_call_expression") return null;
  const callee = call.childForFieldName("function");
  if (callee?.type !== "name" || !(PEST_TESTS.has(callee.text) || PEST_SUITES.has(callee.text))) return null;
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).map((arg) => arg.namedChildren[0]).filter(Boolean);
  const title = literal(args[0]);
  const body = args.slice(1).find((arg) => CLOSURES.has(arg.type));
  if (title === null || !body) return null;
  return { role: PEST_SUITES.has(callee.text) ? "suite" : "test", title, body };
}
function chained(call, method) {
  for (let node = call; node.parent?.type === "member_call_expression" && node.parent.childForFieldName("object")?.id === node.id; node = node.parent) {
    if (node.parent.childForFieldName("name")?.text === method) return true;
  }
  return false;
}
function pestTests(index, scan, root) {
  let hooks = false;
  for (const node of index.of("function_call_expression")) {
    const callee = node.childForFieldName("function");
    if (callee?.type === "name" && PEST_HOOKS.has(callee.text) && node.parent?.parent?.id === root.id) hooks = true;
    const found = pestRole(node);
    if (found?.role === "suite") scan.suites.push({ start: found.body.startIndex, end: found.body.endIndex });
    if (found?.role !== "test") continue;
    const suite = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!CLOSURES.has(parent.type) || parent.parent?.type !== "argument") continue;
      const outer = parent.parent.parent?.parent;
      const role = outer ? pestRole(outer) : null;
      if (role?.role === "suite" && role.body.id === parent.id) suite.unshift(role.title);
    }
    const parametrized = chained(node, "with");
    scan.cases.set(span(found.body), { test: { name: found.title, suite, framework: "pest", ...parametrized ? { parametrized: true } : {} }, qualified: [...suite, found.title].join(" > ") });
  }
  if (hooks && scan.cases.size) scan.suites.push({ start: root.startIndex, end: root.endIndex });
}
var MOCK_METHODS = /* @__PURE__ */ new Set(["createMock", "createStub", "createPartialMock", "createConfiguredMock", "getMockBuilder", "mock", "partialMock", "spy"]);
function classLiteral(argument) {
  const value = argument?.namedChildren[0];
  if (value?.type !== "class_constant_access_expression") return null;
  const [owner, constant] = value.namedChildren;
  return constant?.text === "class" && owner ? lastName(owner) : null;
}
function phpMockTarget(call) {
  const callee = call.type === "function_call_expression" ? call.childForFieldName("function") : call.childForFieldName("name");
  const method = callee?.type === "name" ? callee.text : null;
  if (!method || !MOCK_METHODS.has(method)) return null;
  if (call.type === "scoped_call_expression" && call.childForFieldName("scope")?.text !== "Mockery") return null;
  const name = classLiteral(call.childForFieldName("arguments")?.namedChildren[0]);
  return name ? { kind: "class", name } : null;
}
function phpMocks(index, scan) {
  for (const node of index.of("member_call_expression", "scoped_call_expression", "function_call_expression")) {
    const target = phpMockTarget(node);
    if (target) scan.mocks.push({ owner: ownerIn(node, scan), target, line: lineOf(node) });
  }
}
function phpTests(index, scan, _path) {
  const root = index.all[0];
  phpunitTests(index, scan);
  if (root) pestTests(index, scan, root);
  phpMocks(index, scan);
}

// src/treesitter/tests/lua.ts
var BUSTED_SUITES = /* @__PURE__ */ new Set(["describe", "context", "insulate", "expose"]);
var BUSTED_TESTS = /* @__PURE__ */ new Set(["it", "spec", "test"]);
function bustedRole(call) {
  if (call.type !== "function_call") return null;
  const callee = call.childForFieldName("name");
  if (callee?.type !== "identifier" || !(BUSTED_SUITES.has(callee.text) || BUSTED_TESTS.has(callee.text))) return null;
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => arg.type !== "comment");
  const title = literal(args[0]);
  const body = args.slice(1).find((arg) => arg.type === "function_definition");
  if (title === null || !body) return null;
  return { role: BUSTED_SUITES.has(callee.text) ? "suite" : "test", title, body };
}
function bustedTests(index, scan) {
  for (const node of index.of("function_call")) {
    const found = bustedRole(node);
    if (found?.role === "suite") scan.suites.push({ start: found.body.startIndex, end: found.body.endIndex });
    if (found?.role !== "test") continue;
    const suite = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type !== "function_definition" || parent.parent?.type !== "arguments") continue;
      const outer = bustedRole(parent.parent.parent);
      if (outer?.role === "suite" && outer.body.id === parent.id) suite.unshift(outer.title);
    }
    scan.cases.set(span(found.body), { test: { name: found.title, suite, framework: "busted" }, qualified: [...suite, found.title].join(" > ") });
  }
}
function requiresLuaunit(index) {
  return index.of("function_call").some((call) => call.childForFieldName("name")?.text === "require" && (literal(call.childForFieldName("arguments")?.namedChildren[0]) ?? "").split(".").at(-1) === "luaunit");
}
function declaredOn(node) {
  const name = node.childForFieldName("name");
  if (!name) return null;
  if (name.type === "identifier") return { table: null, method: name.text };
  if (name.type === "method_index_expression" || name.type === "dot_index_expression") {
    const table = name.childForFieldName("table"), method = name.childForFieldName("method") ?? name.childForFieldName("field");
    return table?.type === "identifier" && method?.type === "identifier" ? { table: table.text, method: method.text } : null;
  }
  return null;
}
var TEST_NAME2 = /^[Tt]est/;
function luaunitTests(index, scan) {
  if (!requiresLuaunit(index)) return;
  const declared2 = index.of("function_declaration").map((node) => ({ node, on: declaredOn(node) })).filter((item) => item.on);
  const setup = /* @__PURE__ */ new Map();
  for (const { on } of declared2) {
    if (on.table && ["setUp", "setup"].includes(on.method)) setup.set(on.table, [`${on.table}.${on.method}`]);
  }
  for (const { node, on } of declared2) {
    if (!TEST_NAME2.test(on.method) || on.table !== null && !TEST_NAME2.test(on.table)) continue;
    if (node.parent?.type !== "chunk" && node.parent?.parent?.type !== "chunk") continue;
    const suite = on.table ? [on.table] : [];
    const before = on.table ? setup.get(on.table) : void 0;
    scan.cases.set(span(node), { test: { name: on.method, suite, framework: "luaunit", ...before ? { setup: before } : {} }, qualified: null });
  }
}
function luaMockTarget(call) {
  const callee = call.childForFieldName("name");
  const written = callee?.text ?? "";
  if (!(callee?.type === "identifier" && written === "stub") && !(callee?.type === "dot_index_expression" && written === "spy.on")) return null;
  const args = call.childForFieldName("arguments")?.namedChildren ?? [];
  const object = args[0], name = literal(args[1]);
  if (!object || !name || !["identifier", "dot_index_expression"].includes(object.type)) return null;
  return { kind: "member", object: object.text, name };
}
function luaMocks(index, scan) {
  for (const node of index.of("function_call")) {
    const target = luaMockTarget(node);
    if (target) scan.mocks.push({ owner: ownerIn(node, scan), target, line: lineOf(node) });
  }
}
function luaTests(index, scan, _path) {
  bustedTests(index, scan);
  luaunitTests(index, scan);
  luaMocks(index, scan);
}

// src/treesitter/tests/swift.ts
var TYPES = /* @__PURE__ */ new Set(["class_declaration", "protocol_declaration"]);
var XCTEST_SETUP = /* @__PURE__ */ new Set(["setUp", "setUpWithError"]);
function attributes3(node) {
  const modifiers = node.namedChildren.find((child2) => child2.type === "modifiers");
  return (modifiers?.namedChildren ?? []).filter((child2) => child2.type === "attribute").map((attribute) => {
    const type = attribute.namedChildren.find((child2) => child2.type === "user_type");
    return { name: type?.namedChildren.filter((child2) => child2.type === "type_identifier").at(-1)?.text ?? "", attribute };
  });
}
function inherits(node) {
  return node.namedChildren.filter((child2) => child2.type === "inheritance_specifier").map((child2) => child2.childForFieldName("inherits_from")?.namedChildren.filter((part) => part.type === "type_identifier").at(-1)?.text ?? "").filter(Boolean);
}
var isTestCase = (node) => inherits(node).some((name) => name === "XCTestCase" || /TestCase$/.test(name));
function typeOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (TYPES.has(parent.type)) return parent;
  return null;
}
function xctestSetup(type) {
  const owner = type.childForFieldName("name")?.text;
  if (!owner) return [];
  const setup = [];
  for (const item of type.childForFieldName("body")?.namedChildren ?? []) {
    if (item.type === "property_declaration") {
      const value = item.childForFieldName("value");
      const constructed = value?.type === "call_expression" ? value.namedChildren[0] : null;
      if (constructed?.type === "simple_identifier" && /^[A-Z]/.test(constructed.text)) setup.push(constructed.text);
    } else if (item.type === "function_declaration" && XCTEST_SETUP.has(item.childForFieldName("name")?.text ?? "")) {
      setup.push(`${owner}.${item.childForFieldName("name").text}`);
    }
  }
  return setup;
}
var typeName2 = (scope) => scope.childForFieldName("name")?.text ?? null;
function swiftTests(index, scan, path) {
  void path;
  for (const node of index.of("function_declaration")) {
    if (node.type !== "function_declaration") continue;
    const name = node.childForFieldName("name")?.text ?? "";
    const type = typeOf(node);
    const suite = enclosing(node, TYPES, typeName2);
    const test = attributes3(node).find((attribute) => attribute.name === "Test");
    if (test) {
      const args = test.attribute.namedChildren.filter((child2) => child2.type !== "user_type");
      const title = literal(args[0]);
      const parametrized = args.some((child2) => child2.type === "simple_identifier" && child2.text === "arguments");
      scan.cases.set(span(node), { test: { name: title ?? name, suite, framework: "Testing", ...parametrized ? { parametrized: true } : {} }, qualified: null });
      continue;
    }
    if (!type || !name.startsWith("test") || node.namedChildren.some((child2) => child2.type === "parameter") || !isTestCase(type)) continue;
    const setup = xctestSetup(type);
    scan.cases.set(span(node), { test: { name, suite, framework: "XCTest", ...setup.length ? { setup } : {} }, qualified: null });
  }
}

// src/treesitter/tests/zig.ts
var ESCAPES = { n: "\n", r: "\r", t: "	", "\\": "\\", "'": "'", '"': '"' };
function literal2(node) {
  return node.text.slice(1, -1).replace(/\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|(.))/g, (_, hex, unicode, plain) => {
    if (hex ?? unicode) return String.fromCodePoint(parseInt(hex ?? unicode, 16));
    return ESCAPES[plain] ?? plain;
  });
}
function containers(node) {
  const names2 = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    const name = parent.type === "ContainerDecl" ? zigContainerName(parent) : null;
    if (name) names2.unshift(name.text);
  }
  return names2;
}
function zigTests(index, scan) {
  let unnamed = 0;
  for (const node of index.of("TestDecl")) {
    if (node.type !== "TestDecl") continue;
    const title = node.namedChildren.find((child2) => child2.type === "STRINGLITERALSINGLE" || child2.type === "IDENTIFIER");
    const name = !title ? `test_${unnamed++}` : title.type === "IDENTIFIER" ? title.text : literal2(title);
    const qualified = !title ? name : `${title.type === "IDENTIFIER" ? "decltest" : "test"}.${name}`;
    const suite = containers(node);
    scan.bodies.push(node);
    scan.cases.set(`${node.startIndex}:${node.endIndex}`, { test: { name, suite, framework: "zig" }, qualified: [...suite, qualified].join(".") });
  }
}

// src/treesitter/tests/solidity.ts
var isTestBase = (name) => name === "DSTest" || /Test$/.test(name);
var TEST_PREFIX = /^(?:test|invariant|statefulFuzz)/;
var span2 = (node) => `${node.startIndex}:${node.endIndex}`;
function solidityTests(index, scan) {
  for (const contract of index.of("contract_declaration")) {
    if (contract.type !== "contract_declaration") continue;
    if (contract.children.some((child2) => !child2.isNamed && child2.type === "abstract")) continue;
    const bases = contract.namedChildren.filter((child2) => child2.type === "inheritance_specifier").map((child2) => (child2.childForFieldName("ancestor") ?? child2.namedChildren[0])?.text.split(".").at(-1) ?? "");
    if (!bases.some(isTestBase)) continue;
    const suite = contract.childForFieldName("name")?.text ?? "";
    const functions = (contract.childForFieldName("body")?.namedChildren ?? []).filter((item) => item.type === "function_definition");
    const setup = functions.some((item) => item.childForFieldName("name")?.text === "setUp") ? [`${suite}.setUp`] : [];
    for (const item of functions) {
      const name = item.childForFieldName("name")?.text ?? "";
      const visibility = item.namedChildren.find((child2) => child2.type === "visibility")?.text ?? "";
      if (!TEST_PREFIX.test(name) || !["public", "external"].includes(visibility)) continue;
      const parametrized = item.namedChildren.some((child2) => child2.type === "parameter");
      scan.cases.set(span2(item), {
        test: { name, suite: [suite], framework: "forge", ...setup.length ? { setup } : {}, ...parametrized ? { parametrized: true } : {} },
        qualified: null
      });
    }
  }
}

// src/treesitter/tests/scala.ts
var TYPES2 = /* @__PURE__ */ new Set(["class_definition", "object_definition", "trait_definition"]);
var TEST_CALLS = /* @__PURE__ */ new Set(["test", "it", "they", "property", "scenario", "Scenario"]);
var GROUP_CALLS = { describe: "", feature: "Feature: ", Feature: "Feature: " };
var VERBS = /* @__PURE__ */ new Set(["should", "must", "can", "when", "which", "that", "in", ">>"]);
var SETUP = /* @__PURE__ */ new Set(["beforeEach", "beforeAll"]);
function extended(type) {
  return (type.childForFieldName("extend")?.namedChildren ?? []).map((item) => item.type === "generic_type" ? item.namedChildren[0] : item).filter((item) => item && ["type_identifier", "stable_type_identifier"].includes(item.type)).map((item) => item.text.split(".").at(-1));
}
function imports(index) {
  const named2 = /* @__PURE__ */ new Map(), whole = [];
  for (const node of index.of("import_declaration")) {
    const path = node.namedChildren.filter((child2) => child2.type === "identifier").map((child2) => child2.text);
    const selectors = node.namedChildren.find((child2) => child2.type === "namespace_selectors");
    if (node.namedChildren.some((child2) => child2.type === "namespace_wildcard")) whole.push(path.join("."));
    else if (selectors) {
      for (const item of selectors.namedChildren) {
        if (item.type === "identifier") named2.set(item.text, path.join("."));
        else if (item.type === "namespace_wildcard") whole.push(path.join("."));
        else if (item.type.endsWith("renamed_identifier")) named2.set(item.childForFieldName("alias")?.text ?? item.childForFieldName("name")?.text ?? "", path.join("."));
      }
    } else if (path.length > 1) named2.set(path.at(-1), path.slice(0, -1).join("."));
  }
  return { named: named2, whole };
}
function libraryOf(path) {
  if (/^org\.scalatest(\.|$)/.test(path)) return "scalatest";
  if (/^munit(\.|$)/.test(path)) return "munit";
  if (/^org\.specs2(\.|$)/.test(path)) return "specs2";
  return null;
}
var SCALATEST_BASES = /^(?:Any|Async|Fixture)?(?:FunSuite|FlatSpec|WordSpec|FunSpec|FeatureSpec|FreeSpec|PropSpec|RefSpec)(?:Like)?$/;
var MUNIT_BASES = /^(?:FunSuite|ScalaCheckSuite|CatsEffectSuite|ZSuite|Suite)$/;
var SPECS2_BASES = /^(?:Specification|SpecificationWithJUnit|SpecificationLike)$/;
function frameworkOf2(type, known) {
  const bases = extended(type);
  for (const base of bases) {
    const from = known.named.get(base);
    const library = from ? libraryOf(from) : null;
    if (library) return library;
  }
  const wholes = known.whole.map(libraryOf).filter((library) => library !== null);
  for (const base of bases) {
    if (SCALATEST_BASES.test(base) && (base.startsWith("Any") || base.startsWith("Async") || wholes.includes("scalatest") || !wholes.includes("munit"))) return "scalatest";
    if (MUNIT_BASES.test(base)) return wholes.includes("scalatest") ? "scalatest" : "munit";
    if (SPECS2_BASES.test(base)) return "specs2";
  }
  if (bases.some((base) => /(?:Suite|Spec)$/.test(base)) && wholes.length === 1) return wholes[0];
  return null;
}
function setupOf2(type) {
  const owner = type.childForFieldName("name")?.text;
  if (!owner) return [];
  return (type.childForFieldName("body")?.namedChildren ?? []).filter((item) => item.type === "function_definition" && SETUP.has(item.childForFieldName("name")?.text ?? "")).map((item) => `${owner}.${item.childForFieldName("name").text}`);
}
function titled(argument) {
  if (!argument) return null;
  const written = literal(argument);
  if (written !== null) return { title: written, computed: false };
  if (argument.type === "call_expression" || argument.type === "field_expression") {
    const access = argument.type === "call_expression" ? argument.childForFieldName("function") : argument;
    if (access?.type === "field_expression") {
      const member = access.childForFieldName("field")?.text;
      if (member === "ignore") return null;
      if (member === "tag" || member === "only" || member === "flaky" || member === "fail") return titled(access.childForFieldName("value") ?? void 0);
    }
  }
  if (argument.type === "interpolated_string_expression") return { title: argument.text.replace(/^\w+"""|"""$|^\w+"|"$/g, ""), computed: true };
  return null;
}
function blockCall(node) {
  if (node.type !== "call_expression") return null;
  const block = node.childForFieldName("arguments"), inner = node.childForFieldName("function");
  if (block?.type !== "block" || inner?.type !== "call_expression") return null;
  const callee = inner.childForFieldName("function");
  if (callee?.type !== "identifier") return null;
  const args = inner.childForFieldName("arguments")?.namedChildren.filter((arg) => !arg.type.includes("comment")) ?? [];
  return { callee: callee.text, title: titled(args[0]), block };
}
var clause = (node) => node ? literal(node) ?? (node.type === "interpolated_string_expression" ? node.text : null) : null;
function specTest(node, subjects) {
  if (node.type !== "infix_expression") return null;
  const block = node.childForFieldName("right"), verb = node.childForFieldName("operator")?.text;
  if (block?.type !== "block" || verb !== "in" && verb !== ">>") return null;
  const words = clauseWords(node.childForFieldName("left"), subjects);
  if (!words) return null;
  const outer = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "infix_expression" || parent.childForFieldName("right")?.type !== "block") continue;
    const around = clauseWords(parent.childForFieldName("left"), subjects);
    if (!around || !VERBS.has(parent.childForFieldName("operator")?.text ?? "")) return null;
    outer.unshift(`${around} ${parent.childForFieldName("operator").text}`);
  }
  return { name: [...outer, words].join(" "), block };
}
function clauseWords(left, subjects) {
  if (!left) return null;
  const own = clause(left);
  if (own !== null) return own;
  if (left.type !== "infix_expression") return null;
  const verb = left.childForFieldName("operator")?.text ?? "";
  if (!VERBS.has(verb)) return null;
  const subject = left.childForFieldName("left"), rest = clause(left.childForFieldName("right"));
  if (rest === null) return null;
  const head = subject && ["it", "they"].includes(subject.text) ? subjects.get(subjectKey(left)) ?? null : clause(subject);
  return head === null ? null : `${head} ${verb} ${rest}`;
}
function subjectKey(node) {
  for (let statement = node; statement.parent; statement = statement.parent) if (statement.parent.type === "template_body") return span(statement);
  return "file";
}
function subjectsOf(body) {
  const subjects = /* @__PURE__ */ new Map();
  let current = null;
  for (const item of body.namedChildren) {
    if (item.type !== "infix_expression") continue;
    const verb = item.childForFieldName("operator")?.text;
    const left = item.childForFieldName("left");
    if (left?.text === "behavior" && verb === "of") {
      current = clause(item.childForFieldName("right")) ?? current;
      continue;
    }
    let head = item;
    while (head?.type === "infix_expression") head = head.childForFieldName("left");
    const subject = clause(head);
    if (subject !== null && head?.parent?.type === "infix_expression" && VERBS.has(head.parent.childForFieldName("operator")?.text ?? "")) current = subject;
    if (current !== null) subjects.set(span(item), current);
  }
  return subjects;
}
function scalaTests(index, scan, path) {
  void path;
  const known = imports(index);
  const typeName3 = (scope) => scope.childForFieldName("name")?.text ?? null;
  for (const type of index.of("class_definition", "object_definition", "trait_definition")) {
    if (!TYPES2.has(type.type)) continue;
    const framework = frameworkOf2(type, known);
    const body = type.childForFieldName("body");
    if (!framework || !body) continue;
    scan.suites.push({ start: body.startIndex, end: body.endIndex });
    const suite = [...enclosing(type, TYPES2, typeName3), typeName3(type) ?? ""].filter(Boolean);
    const setup = setupOf2(type);
    const subjects = subjectsOf(body);
    const add = (name, block, computed = false) => {
      scan.bodies.push(block);
      scan.cases.set(span(block), { test: { name, suite, framework, ...computed ? { parametrized: true } : {}, ...setup.length ? { setup } : {} }, qualified: [...suite, name].join(".") });
    };
    for (const node of index.within(body)) {
      if (node === body || enclosingBody(node) !== body) continue;
      const call = blockCall(node);
      if (call && TEST_CALLS.has(call.callee) && call.title) {
        const groups = [];
        let computed = call.title.computed;
        for (let parent = node.parent; parent && parent !== body; parent = parent.parent) {
          const group = blockCall(parent);
          if (!group || !(group.callee in GROUP_CALLS)) continue;
          if (!group.title) {
            groups.length = 0;
            break;
          }
          groups.unshift(`${GROUP_CALLS[group.callee]}${group.title.title}`);
          computed ||= group.title.computed;
        }
        const own = call.callee === "scenario" || call.callee === "Scenario" ? `Scenario: ${call.title.title}` : call.title.title;
        add([...groups, own].join(" "), call.block, computed);
        continue;
      }
      const spec = specTest(node, subjects);
      if (spec) add(spec.name, spec.block);
    }
  }
}
function enclosingBody(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === "template_body") return parent;
  return null;
}

// src/treesitter/tests/groovy.ts
function groovyTests(index, scan, path) {
  void index;
  void scan;
  void path;
}

// src/treesitter/tests/bash.ts
function bashTests(index, scan, path) {
  void index;
  void scan;
  void path;
}

// src/treesitter/tests.ts
var span = (node) => `${node.startIndex}:${node.endIndex}`;
var named = (node, type) => node.namedChildren.filter((child2) => child2.type === type);
var lineOf = (node) => node.startPosition.row + 1;
function ownerOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (isFunction(parent)) return `function:${parent.startIndex}`;
  return "file";
}
function ownerIn(node, scan) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunction(parent) || scan.cases.has(span(parent))) return `function:${parent.startIndex}`;
  }
  return "file";
}
function enclosing(node, types, nameOf) {
  const names2 = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!types.has(parent.type)) continue;
    const name = nameOf(parent);
    if (name) names2.unshift(name);
  }
  return names2;
}
function dotted(node, member, object, property) {
  if (!node) return null;
  if (["identifier", "this", "self", "property_identifier", "simple_identifier", "type_identifier"].includes(node.type)) return node.text;
  if (node.type !== member) return null;
  const head = dotted(node.childForFieldName(object), member, object, property);
  const tail = node.childForFieldName(property);
  return head && tail ? `${head}.${tail.text}` : null;
}
var SIMPLE_ESCAPES = { n: "\n", t: "	", r: "\r", b: "\b", f: "\f", v: "\v", a: "\x07", 0: "\0" };
function unescape(sequence) {
  const body = sequence.slice(1);
  if (body === "\n" || body === "\r\n") return "";
  if (/^[0-7]{1,3}$/.test(body) && body !== "0") return String.fromCodePoint(parseInt(body, 8));
  const hex = /^(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]+)\}|U([0-9a-fA-F]{8}))$/.exec(body);
  if (hex) return String.fromCodePoint(parseInt(hex[1] ?? hex[2] ?? hex[3] ?? hex[4], 16));
  if (body.startsWith("N{")) return sequence;
  return SIMPLE_ESCAPES[body] ?? body;
}
function literal(node) {
  if (!node) return null;
  const parts = node.namedChildren;
  if (parts.some((part) => ["template_substitution", "interpolation", "string_interpolation", "interpolated_expression"].includes(part.type))) return null;
  if (node.type === "encapsed_string" && parts.some((part) => !["string_content", "escape_sequence"].includes(part.type))) return null;
  if (!["string", "template_string", "string_literal", "raw_string_literal", "interpreted_string_literal", "line_string_literal", "verbatim_string_literal", "encapsed_string"].includes(node.type)) return null;
  const raw = node.type === "raw_string_literal" || node.type === "verbatim_string_literal" || /^[a-zA-Z]*[rR][a-zA-Z]*["']/.test(parts.find((part) => part.type === "string_start")?.text ?? "");
  if (!parts.length) return node.text.replace(/^[a-zA-Z@]*(?:"""|"|')|(?:"""|"|')$/g, "");
  return parts.filter((part) => ["string_fragment", "string_content", "escape_sequence", "interpreted_string_literal_content", "raw_string_literal_content", "line_str_text", "string_literal_content"].includes(part.type)).map((part) => part.type === "escape_sequence" && !raw ? unescape(part.text) : part.text).join("");
}
var PY_PATCH = /* @__PURE__ */ new Set(["patch", "mock.patch", "unittest.mock.patch", "mocker.patch"]);
var PY_PATCH_OBJECT = /* @__PURE__ */ new Set(["patch.object", "mock.patch.object", "unittest.mock.patch.object", "mocker.patch.object", "mocker.spy"]);
var PY_TESTCASE = /* @__PURE__ */ new Set(["TestCase", "IsolatedAsyncioTestCase"]);
function pytestCollects(path) {
  const base = path?.split("/").at(-1) ?? "";
  return base.endsWith(".py") && (base.startsWith("test_") || base.endsWith("_test.py"));
}
var pyDotted = (node) => dotted(node, "attribute", "object", "attribute");
function pythonTestClass(node) {
  const bases = node.childForFieldName("superclasses")?.namedChildren ?? [];
  if (bases.some((base) => {
    const name = pyDotted(base)?.split(".").at(-1) ?? "";
    return PY_TESTCASE.has(name) || /(TestCase|TestBase)$/.test(name);
  })) return "unittest";
  return node.childForFieldName("name")?.text.startsWith("Test") ? "pytest" : null;
}
var PY_SETUP = /* @__PURE__ */ new Set(["setUp", "asyncSetUp", "setUpClass", "setup_method", "setup_class", "setup"]);
function pythonSetup(body) {
  return body.namedChildren.map((item) => item.type === "decorated_definition" ? item.childForFieldName("definition") : item).filter((item) => item?.type === "function_definition").map((item) => item.childForFieldName("name")?.text ?? "").filter((name) => PY_SETUP.has(name)).map((name) => `self.${name}`);
}
function pythonTests(index, path, scan) {
  const collected = pytestCollects(path);
  const classNames = /* @__PURE__ */ new Set(["class_definition"]);
  for (const node of index.of("function_definition")) {
    if (node.type !== "function_definition") continue;
    const name = node.childForFieldName("name")?.text ?? "";
    if (!name.startsWith("test")) continue;
    const holder = node.parent?.type === "decorated_definition" ? node.parent : node;
    const container = holder.parent;
    const suite = enclosing(node, classNames, (scope) => scope.childForFieldName("name")?.text ?? null);
    if (container?.type === "module") {
      if (collected) scan.cases.set(span(node), { test: { name, suite, framework: "pytest" }, qualified: null });
    } else if (container?.type === "block" && container.parent?.type === "class_definition") {
      const framework = pythonTestClass(container.parent);
      const setup = pythonSetup(container);
      if (framework) scan.cases.set(span(node), { test: { name, suite, framework, ...setup.length ? { setup } : {} }, qualified: null });
    }
  }
}
function pythonMockTarget(call) {
  const callee = pyDotted(call.childForFieldName("function"));
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => arg.type !== "comment");
  if (!callee) return null;
  const path = literal(args[0]);
  if (PY_PATCH.has(callee)) return path ? { kind: "path", path } : null;
  const object = pyDotted(args[0] ?? null), name = literal(args[1]);
  if (callee === "monkeypatch.setattr") {
    if (path && args.length === 2) return { kind: "path", path };
    return object && name ? { kind: "member", object, name } : null;
  }
  if (PY_PATCH_OBJECT.has(callee)) return object && name ? { kind: "member", object, name } : null;
  return null;
}
function pythonMocks(index, scan) {
  for (const node of index.of("call")) {
    if (node.type !== "call") continue;
    const target = pythonMockTarget(node);
    if (!target) continue;
    const line = lineOf(node);
    const decorated = node.parent?.type === "decorator" ? node.parent.parent?.childForFieldName("definition") : null;
    if (decorated?.type === "function_definition") scan.mocks.push({ owner: `function:${decorated.startIndex}`, target, line });
    else if (decorated?.type === "class_definition") {
      for (const member of decorated.childForFieldName("body")?.namedChildren ?? []) {
        const method = member.type === "decorated_definition" ? member.childForFieldName("definition") : member;
        if (method?.type === "function_definition" && scan.cases.has(span(method))) scan.mocks.push({ owner: `function:${method.startIndex}`, target, line });
      }
    } else scan.mocks.push({ owner: ownerOf(node), target, line });
  }
}
var JS_TESTS = /* @__PURE__ */ new Set(["it", "test", "specify"]);
var JS_SUITES = /* @__PURE__ */ new Set(["describe", "context", "suite"]);
var JS_FUNCTIONS = /* @__PURE__ */ new Set(["arrow_function", "function_expression", "function"]);
var JS_MODULE_MOCKS = /* @__PURE__ */ new Set(["mock", "doMock", "unstable_mockModule"]);
function calleeChain(callee) {
  const properties = [];
  for (let node = callee; node; ) {
    if (node.type === "identifier") return { head: node.text, properties: properties.reverse() };
    if (node.type === "member_expression") {
      properties.push(node.childForFieldName("property")?.text ?? "");
      node = node.childForFieldName("object");
    } else if (node.type === "call_expression") node = node.childForFieldName("function");
    else return null;
  }
  return null;
}
function jsImports(index) {
  const sources = /* @__PURE__ */ new Map();
  for (const node of index.of("import_statement", "variable_declarator")) {
    if (node.type === "import_statement") {
      const source = literal(node.childForFieldName("source"));
      if (!source) continue;
      for (const item of index.within(node)) {
        if (item.type === "import_specifier") sources.set((item.childForFieldName("alias") ?? item.childForFieldName("name"))?.text ?? "", source);
        else if (item.type === "identifier" && ["import_clause", "namespace_import"].includes(item.parent?.type ?? "")) sources.set(item.text, source);
      }
    } else if (node.type === "variable_declarator") {
      const value = node.childForFieldName("value");
      if (value?.type !== "call_expression" || value.childForFieldName("function")?.text !== "require") continue;
      const source = literal(value.childForFieldName("arguments")?.namedChildren[0]);
      const binding = node.childForFieldName("name");
      if (!source || !binding) continue;
      if (binding.type === "identifier") sources.set(binding.text, source);
      for (const item of index.within(binding)) {
        if (item.type === "shorthand_property_identifier_pattern") sources.set(item.text, source);
        else if (item.type === "pair_pattern") sources.set(item.childForFieldName("value")?.text ?? "", source);
      }
    }
  }
  return sources;
}
function titled2(call) {
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => arg.type !== "comment");
  const body = args.slice(1).find((arg) => JS_FUNCTIONS.has(arg.type));
  if (!args[0] || !body || JS_FUNCTIONS.has(args[0].type)) return null;
  const title = literal(args[0]);
  if (title !== null) return { title, body, computed: false };
  return { title: computedTitle(args[0]).replace(/\s+/g, " ").slice(0, 120), body, computed: true };
}
function computedTitle(node) {
  const written = literal(node);
  if (written !== null) return written;
  if (node.type === "template_string") {
    return node.namedChildren.map((part) => part.type === "template_substitution" ? `\${${part.namedChildren[0]?.text ?? ""}}` : part.type === "escape_sequence" ? unescape(part.text) : part.text).join("");
  }
  if (node.type === "parenthesized_expression" && node.namedChildren.length === 1) return computedTitle(node.namedChildren[0]);
  if (node.type === "binary_expression" && node.childForFieldName("operator")?.text === "+") {
    return computedTitle(node.childForFieldName("left")) + computedTitle(node.childForFieldName("right"));
  }
  return `\${${node.text}}`;
}
function jsRole(call, imports2) {
  if (call.type !== "call_expression") return null;
  const chain = calleeChain(call.childForFieldName("function"));
  const shape = chain ? titled2(call) : null;
  if (!chain || !shape) return null;
  const each = chain.properties.includes("each") || shape.computed;
  if (JS_SUITES.has(chain.head) || JS_TESTS.has(chain.head) && chain.properties.includes("describe")) return { role: "suite", ...shape, framework: "", each };
  if (chain.head === "Deno" && chain.properties.length === 1 && chain.properties[0] === "test") return { role: "test", ...shape, framework: "deno", each };
  if (JS_TESTS.has(chain.head)) return { role: "test", ...shape, framework: imports2.get(chain.head) ?? "global", each };
  return null;
}
function jsTests(index, scan) {
  const imports2 = jsImports(index);
  for (const node of index.of("call_expression")) {
    const found = jsRole(node, imports2);
    if (found?.role === "suite") scan.suites.push({ start: found.body.startIndex, end: found.body.endIndex });
    if (found?.role !== "test") continue;
    const suite = [];
    let nested = false, parametrized = found.each;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!JS_FUNCTIONS.has(parent.type) || parent.parent?.type !== "arguments") continue;
      const outer = jsRole(parent.parent.parent, imports2);
      if (outer?.body.id !== parent.id) continue;
      if (outer.role === "test") nested = true;
      else {
        suite.unshift(outer.title);
        parametrized ||= outer.each;
      }
    }
    if (nested) continue;
    const test = { name: found.title, suite, framework: found.framework, ...parametrized ? { parametrized: true } : {} };
    scan.cases.set(span(found.body), { test, qualified: [...suite, found.title].join(" > ") });
  }
}
var jsDotted = (node) => dotted(node, "member_expression", "object", "property");
function jsMockTarget(call) {
  const callee = call.childForFieldName("function");
  if (callee?.type !== "member_expression") return null;
  const object = jsDotted(callee.childForFieldName("object")), property = callee.childForFieldName("property")?.text ?? "";
  const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => arg.type !== "comment");
  if ((object === "vi" || object === "jest") && JS_MODULE_MOCKS.has(property)) {
    const module = literal(args[0]);
    return module ? { kind: "module", module } : null;
  }
  const member = () => {
    const target = jsDotted(args[0] ?? null), name = literal(args[1]);
    return target && name ? { kind: "member", object: target, name } : null;
  };
  if ((object === "vi" || object === "jest") && property === "spyOn") return member();
  if (object === "sinon" && ["stub", "spy", "replace"].includes(property)) return member();
  if (property === "method" && object?.split(".").at(-1) === "mock") return member();
  if (property === "module" && object?.split(".").at(-1) === "mock") {
    const module = literal(args[0]);
    return module ? { kind: "module", module } : null;
  }
  return null;
}
function jsMocks(index, scan) {
  for (const node of index.of("call_expression")) {
    if (node.type !== "call_expression") continue;
    const target = jsMockTarget(node);
    if (target) scan.mocks.push({ owner: ownerOf(node), target, line: lineOf(node) });
  }
}
var RUST_TESTS = /* @__PURE__ */ new Set(["test", "rstest"]);
var RUST_ITEMS = /* @__PURE__ */ new Set(["source_file", "declaration_list"]);
function rustTests(index, scan) {
  const modules = /* @__PURE__ */ new Set(["mod_item"]);
  for (const container of index.of("source_file", "declaration_list")) {
    if (!RUST_ITEMS.has(container.type)) continue;
    let marker = null;
    for (const item of container.namedChildren) {
      if (item.type.includes("comment")) continue;
      if (item.type === "attribute_item") {
        const path = item.namedChildren.find((child2) => child2.type === "attribute")?.namedChildren[0] ?? null;
        const last = path?.type === "scoped_identifier" ? path.childForFieldName("name") : path;
        if (path && last && ["identifier", "scoped_identifier"].includes(path.type) && RUST_TESTS.has(last.text)) marker ??= path.text;
        continue;
      }
      if (item.type === "function_item" && marker) {
        const name = item.childForFieldName("name")?.text ?? "";
        const suite = enclosing(item, modules, (scope) => scope.childForFieldName("name")?.text ?? null);
        scan.cases.set(span(item), { test: { name, suite, framework: marker }, qualified: null });
      }
      marker = null;
    }
  }
}
function rustMocks(index, scan) {
  for (const node of index.of("call_expression")) {
    if (node.type !== "call_expression") continue;
    const callee = node.childForFieldName("function");
    if (callee?.type !== "scoped_identifier") continue;
    const type = callee.childForFieldName("path"), method = callee.childForFieldName("name")?.text;
    if (type?.type !== "identifier" || !["new", "default"].includes(method ?? "")) continue;
    if (type.text.startsWith("Mock") && type.text.length > 4)
      scan.mocks.push({ owner: ownerOf(node), target: { kind: "class", name: type.text.slice(4) }, line: lineOf(node) });
  }
}
var JVM_TESTS = /* @__PURE__ */ new Set(["Test", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate"]);
var JVM_MOCK_FIELDS = /* @__PURE__ */ new Set(["Mock", "Spy", "MockBean", "SpyBean", "MockitoBean", "MockitoSpyBean", "MockK", "RelaxedMockK", "SpyK"]);
var MOCKITO_CALLS = /* @__PURE__ */ new Set(["mock", "spy", "mockStatic", "mockConstruction"]);
var MOCKK_CALLS = /* @__PURE__ */ new Set(["mockk", "spyk", "mockkClass", "mockkObject", "mockkStatic", "mockkConstructor"]);
var JAVA_CLASSES = /* @__PURE__ */ new Set(["class_declaration", "enum_declaration", "record_declaration", "interface_declaration"]);
var KOTLIN_CLASSES = /* @__PURE__ */ new Set(["class_declaration", "object_declaration"]);
function annotations(node, language) {
  const modifiers = node.namedChildren.find((child2) => child2.type === "modifiers");
  const found = [];
  for (const item of modifiers?.namedChildren ?? []) {
    if (language === "java" && (item.type === "marker_annotation" || item.type === "annotation")) {
      const name = item.childForFieldName("name");
      const last = name?.type === "scoped_identifier" ? name.childForFieldName("name") : name;
      if (name && last) found.push({ written: name.text, name: last.text });
    } else if (language === "kotlin" && item.type === "annotation") {
      const type = item.namedChildren.find((child2) => child2.type === "user_type") ?? item.namedChildren.find((child2) => child2.type === "constructor_invocation")?.namedChildren.find((child2) => child2.type === "user_type");
      const parts = type ? named(type, "type_identifier").map((part) => part.text) : [];
      if (parts.length) found.push({ written: parts.join("."), name: parts.at(-1) });
    }
  }
  return found;
}
function javaTypeName(type) {
  if (!type) return null;
  if (type.type === "type_identifier") return type.text;
  if (type.type === "generic_type") return javaTypeName(type.namedChildren[0] ?? null);
  if (type.type === "scoped_type_identifier") return javaTypeName(type.namedChildren.at(-1) ?? null);
  return null;
}
var kotlinTypeName = (type) => type ? named(type, "type_identifier").at(-1)?.text ?? null : null;
var JVM_SETUP = /* @__PURE__ */ new Set(["BeforeEach", "BeforeAll", "Before", "BeforeClass", "BeforeMethod"]);
function jvmSetup(node, language, classes, className2) {
  const kind = language === "java" ? "method_declaration" : "function_declaration";
  const setup = [];
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!classes.has(scope.type)) continue;
    const owner = className2(scope);
    const body = scope.childForFieldName("body") ?? scope.namedChildren.find((child2) => child2.type === "class_body") ?? null;
    for (const item of body?.namedChildren ?? []) {
      if (item.type !== kind || !owner || !annotations(item, language).some((annotation) => JVM_SETUP.has(annotation.name))) continue;
      const name = (language === "java" ? item.childForFieldName("name") : item.namedChildren.find((child2) => child2.type === "simple_identifier"))?.text;
      if (name) setup.push(`${owner}.${name}`);
    }
  }
  return setup;
}
function jvmTests(index, language, scan) {
  const kind = language === "java" ? "method_declaration" : "function_declaration";
  const classes = language === "java" ? JAVA_CLASSES : KOTLIN_CLASSES;
  const className2 = (scope) => (language === "java" ? scope.childForFieldName("name")?.text : scope.namedChildren.find((child2) => ["type_identifier", "simple_identifier"].includes(child2.type))?.text) ?? null;
  for (const node of index.of(kind)) {
    if (node.type !== kind) continue;
    const marker = annotations(node, language).find((annotation) => JVM_TESTS.has(annotation.name)) ?? (language === "java" ? testngClassMarker(node) : void 0);
    if (!marker) continue;
    const name = (language === "java" ? node.childForFieldName("name") : node.namedChildren.find((child2) => child2.type === "simple_identifier"))?.text ?? "";
    const setup = jvmSetup(node, language, classes, className2);
    scan.cases.set(span(node), { test: { name, suite: enclosing(node, classes, className2), framework: marker.written, ...setup.length ? { setup } : {} }, qualified: null });
  }
}
var TESTNG_NOT_TESTS = /* @__PURE__ */ new Set([
  "BeforeSuite",
  "AfterSuite",
  "BeforeTest",
  "AfterTest",
  "BeforeGroups",
  "AfterGroups",
  "BeforeClass",
  "AfterClass",
  "BeforeMethod",
  "AfterMethod",
  "DataProvider",
  "Factory"
]);
function testngClassMarker(method) {
  const owner = method.parent?.type === "class_body" ? method.parent.parent : null;
  if (owner?.type !== "class_declaration") return void 0;
  const marker = annotations(owner, "java").find((annotation) => annotation.name === "Test");
  if (!marker) return void 0;
  const modifiers = method.namedChildren.find((child2) => child2.type === "modifiers");
  if (!modifiers || !Array.from({ length: modifiers.childCount }, (_, index) => modifiers.child(index)).some((child2) => child2?.type === "public")) return void 0;
  if (annotations(method, "java").some((annotation) => TESTNG_NOT_TESTS.has(annotation.name))) return void 0;
  return marker;
}
function javaMocks(index, scan) {
  for (const node of index.of("field_declaration", "method_invocation")) {
    if (node.type === "field_declaration" && annotations(node, "java").some((annotation) => JVM_MOCK_FIELDS.has(annotation.name))) {
      const name = javaTypeName(node.childForFieldName("type"));
      if (name) scan.mocks.push({ owner: "file", target: { kind: "class", name }, line: lineOf(node) });
    } else if (node.type === "method_invocation" && MOCKITO_CALLS.has(node.childForFieldName("name")?.text ?? "")) {
      const object = node.childForFieldName("object");
      if (object && object.text !== "Mockito") continue;
      const literalClass = node.childForFieldName("arguments")?.namedChildren[0];
      const name = literalClass?.type === "class_literal" ? javaTypeName(literalClass.namedChildren[0] ?? null) : null;
      if (name) scan.mocks.push({ owner: ownerOf(node), target: { kind: "class", name }, line: lineOf(node) });
    }
  }
}
function kotlinMocks(index, scan) {
  for (const node of index.of("property_declaration", "call_expression")) {
    if (node.type === "property_declaration" && annotations(node, "kotlin").some((annotation) => JVM_MOCK_FIELDS.has(annotation.name))) {
      const declared2 = node.namedChildren.find((child2) => child2.type === "variable_declaration");
      const name = kotlinTypeName(declared2?.namedChildren.find((child2) => child2.type === "user_type"));
      if (name) scan.mocks.push({ owner: "file", target: { kind: "class", name }, line: lineOf(node) });
    } else if (node.type === "call_expression") {
      const callee = node.namedChildren[0];
      if (callee?.type !== "simple_identifier" || !MOCKK_CALLS.has(callee.text)) continue;
      const suffix = node.namedChildren.find((child2) => child2.type === "call_suffix");
      const typed = suffix?.namedChildren.find((child2) => child2.type === "type_arguments")?.namedChildren[0]?.namedChildren.find((child2) => child2.type === "user_type");
      const argument = suffix?.namedChildren.find((child2) => child2.type === "value_arguments")?.namedChildren[0]?.namedChildren[0];
      const reference = argument?.type === "callable_reference" ? argument.namedChildren.find((child2) => child2.type === "type_identifier") : void 0;
      const name = kotlinTypeName(typed) ?? reference?.text ?? (argument?.type === "simple_identifier" && callee.text === "mockkObject" ? argument.text : null);
      if (name) scan.mocks.push({ owner: ownerOf(node), target: { kind: "class", name }, line: lineOf(node) });
    }
  }
}
var GTEST = /* @__PURE__ */ new Set(["TEST", "TEST_F", "TEST_P", "TYPED_TEST", "TYPED_TEST_P"]);
var CATCH_FIXTURES = /* @__PURE__ */ new Set(["TEST_CASE_METHOD", "CATCH_TEST_CASE_METHOD", "SCENARIO_METHOD", "CATCH_SCENARIO_METHOD", "TEST_CASE_FIXTURE", "DOCTEST_TEST_CASE_FIXTURE"]);
var CATCH = /* @__PURE__ */ new Set(["TEST_CASE", "SCENARIO", "CATCH_TEST_CASE", "CATCH_SCENARIO", "DOCTEST_TEST_CASE", "DOCTEST_SCENARIO", ...CATCH_FIXTURES]);
function cppMembers(index, fixture) {
  let body = null;
  for (const node of index.of("class_specifier", "struct_specifier")) {
    if ((node.type === "class_specifier" || node.type === "struct_specifier") && node.childForFieldName("name")?.text === fixture) {
      body = node.childForFieldName("body");
      break;
    }
  }
  return (body?.namedChildren ?? []).filter((item) => item.type === "field_declaration" && item.childForFieldName("default_value")).map((item) => item.childForFieldName("type")).filter((type) => type && ["type_identifier", "qualified_identifier", "template_type"].includes(type.type) && !type.text.startsWith("std::")).map((type) => type.text.replace(/<[\s\S]*>$/, ""));
}
function decoratedTitle(node) {
  if (node?.type === "binary_expression" && node.childForFieldName("operator")?.text === "*") return decoratedTitle(node.childForFieldName("left") ?? void 0);
  return literal(node);
}
var CATCH2_BLOCKS = ["TEST_CASE", "SCENARIO", "SECTION", "DYNAMIC_SECTION", "GIVEN", "AND_GIVEN", "WHEN", "AND_WHEN", "THEN", "AND_THEN"];
var DOCTEST_BLOCKS = ["TEST_CASE", "SCENARIO", "TEST_SUITE", "SUBCASE", "GIVEN", "AND_GIVEN", "WHEN", "AND_WHEN", "THEN", "AND_THEN"];
var BLOCK_MACROS = {
  catch2: /* @__PURE__ */ new Set([...CATCH2_BLOCKS, ...CATCH2_BLOCKS.map((name) => `CATCH_${name}`)]),
  doctest: /* @__PURE__ */ new Set([...DOCTEST_BLOCKS, ...DOCTEST_BLOCKS.map((name) => `DOCTEST_${name}`)])
};
function macroDefinition(node) {
  const declarator = node.childForFieldName("declarator");
  if (declarator?.type !== "function_declarator") return null;
  const macro = declarator.childForFieldName("declarator");
  if (macro?.type !== "identifier") return null;
  return { macro: macro.text, parameters: named(declarator.childForFieldName("parameters") ?? declarator, "parameter_declaration") };
}
var CPP_SCOPES = /* @__PURE__ */ new Set(["translation_unit", "declaration_list"]);
function cppTests(index, scan) {
  for (const node of index.of("function_definition")) {
    if (node.type !== "function_definition") continue;
    const definition = macroDefinition(node);
    if (!definition || !GTEST.has(definition.macro) || definition.parameters.length !== 2) continue;
    const [suite, name] = definition.parameters.map((parameter) => parameter.childForFieldName("type"));
    if (suite?.type !== "type_identifier" || name?.type !== "type_identifier" || parameterHasDeclarator(definition.parameters)) continue;
    const setup = definition.macro === "TEST" ? [] : [suite.text, ...cppMembers(index, suite.text), `${suite.text}.SetUp`];
    scan.cases.set(span(node), { test: { name: name.text, suite: [suite.text], framework: definition.macro, ...setup.length ? { setup } : {} }, qualified: `${suite.text}.${name.text}` });
  }
  const library = cppLibrary(index);
  if (library) scan.blockMacros = BLOCK_MACROS[library];
  for (const scope of index.of("translation_unit", "declaration_list", "compound_statement")) {
    const suite = testScope(scope, library);
    if (!suite) continue;
    const items = scope.namedChildren.filter((item) => !item.type.includes("comment"));
    for (const [at, item] of items.entries()) {
      const macro = macroCall(item);
      if (!macro || !CATCH.has(macro.name)) continue;
      const fixture = CATCH_FIXTURES.has(macro.name) ? macro.arguments[0]?.text ?? null : null;
      const written = decoratedTitle(macro.arguments[fixture === null ? 0 : 1]);
      const body = items[at + 1];
      if (written === null || body?.type !== "compound_statement") continue;
      const name = macro.name.endsWith("SCENARIO") && library ? `${SCENARIO_PREFIX[library]}${written}` : written;
      scan.bodies.push(body);
      const fixed = fixture === null ? {} : { fixture, setup: [fixture, ...cppMembers(index, fixture)] };
      scan.cases.set(span(body), { test: { name, suite, framework: library ?? macro.name, ...fixed }, qualified: [...suite, name].join(".") });
    }
  }
}
function includedHeaders(index) {
  const headers = [];
  for (const node of index.of("preproc_include")) {
    if (node.type !== "preproc_include") continue;
    const path = node.childForFieldName("path");
    const header = path?.type === "system_lib_string" ? path.text.slice(1, -1) : literal(path);
    if (header) headers.push(header);
  }
  return headers;
}
function cppLibrary(index) {
  for (const header of includedHeaders(index)) {
    if (header.startsWith("catch2/") || header === "catch.hpp") return "catch2";
    if (header === "doctest.h" || header.endsWith("/doctest.h")) return "doctest";
  }
  return null;
}
var SCENARIO_PREFIX = { catch2: "Scenario: ", doctest: "  Scenario: " };
function macroCall(item) {
  const call = item.type === "expression_statement" ? item.namedChildren[0] : null;
  const macro = call?.type === "call_expression" ? call.childForFieldName("function") : null;
  if (macro?.type !== "identifier") return null;
  return { name: macro.text, arguments: (call.childForFieldName("arguments")?.namedChildren ?? []).filter((arg) => !arg.type.includes("comment")) };
}
function doctestSuite(block) {
  if (block.type !== "compound_statement" || !block.parent) return null;
  const items = block.parent.namedChildren.filter((item) => !item.type.includes("comment"));
  const index = items.findIndex((item) => item.startIndex === block.startIndex);
  const macro = index > 0 ? macroCall(items[index - 1]) : null;
  return macro?.name === "TEST_SUITE" || macro?.name === "DOCTEST_TEST_SUITE" ? literal(macro.arguments[0]) : null;
}
function testScope(scope, library) {
  const suiteOf = (node) => library === "doctest" ? doctestSuite(node) : null;
  if (!CPP_SCOPES.has(scope.type) && suiteOf(scope) === null) return null;
  const suites = [];
  for (let node = scope; node; node = node.parent) {
    const name = suiteOf(node);
    if (name !== null) suites.unshift(name);
  }
  return suites;
}
var parameterHasDeclarator = (parameters) => parameters.some((parameter) => parameter.childForFieldName("declarator"));
function cppMocks(index, scan) {
  for (const node of index.of("class_specifier", "struct_specifier")) {
    if (node.type !== "class_specifier" && node.type !== "struct_specifier") continue;
    const body = node.childForFieldName("body");
    const mocking = body && index.within(body).some((item) => item.type === "function_declarator" && item.childForFieldName("declarator")?.type === "identifier" && ["MOCK_METHOD", "MOCK_CONST_METHOD"].some((prefix) => item.childForFieldName("declarator").text.startsWith(prefix)));
    if (!mocking) continue;
    const bases = node.namedChildren.find((child2) => child2.type === "base_class_clause")?.namedChildren ?? [];
    for (const base of bases) {
      const name = base.type === "type_identifier" ? base.text : base.type === "qualified_identifier" ? base.childForFieldName("name")?.text : null;
      if (name) scan.mocks.push({ owner: "file", target: { kind: "class", name }, line: lineOf(node) });
    }
  }
}
function packageOf(root, language) {
  for (const node of root.namedChildren) {
    if (language === "java" && node.type === "package_declaration") return node.namedChildren.find((child2) => child2.type.endsWith("identifier"))?.text ?? null;
    if (language === "kotlin" && node.type === "package_header") {
      const name = node.namedChildren.find((child2) => child2.type === "identifier");
      return name ? named(name, "simple_identifier").map((part) => part.text).join(".") : null;
    }
    if (language === "go" && node.type === "package_clause") return node.namedChildren.find((child2) => child2.type === "package_identifier")?.text ?? null;
    if (language === "csharp" && ["namespace_declaration", "file_scoped_namespace_declaration"].includes(node.type)) return node.childForFieldName("name")?.text ?? null;
    if (language === "php" && node.type === "namespace_definition") return node.childForFieldName("name")?.text ?? null;
  }
  if (language === "scala") {
    const clauses = root.namedChildren.filter((node) => node.type === "package_clause").map((node) => node.childForFieldName("name")?.text ?? "").filter(Boolean);
    return clauses.length ? clauses.join(".") : null;
  }
  return null;
}
var OTHERS = {
  go: goTests,
  // The analyzer normalizes `c_sharp`, the id languages.js gives a .cs file, to the grammar's `csharp` before anything reads the tree.
  csharp: csharpTests,
  c_sharp: csharpTests,
  ruby: rubyTests,
  php: phpTests,
  lua: luaTests,
  swift: swiftTests,
  zig: zigTests,
  solidity: solidityTests,
  scala: scalaTests,
  groovy: groovyTests,
  bash: bashTests
};
function findTests(root, language, path, index) {
  const scan = { cases: /* @__PURE__ */ new Map(), bodies: [], mocks: [], package: packageOf(root, language), blockMacros: /* @__PURE__ */ new Set(), suites: [] };
  if (language === "python") {
    pythonTests(index, path, scan);
    pythonMocks(index, scan);
  } else if (["javascript", "typescript", "tsx"].includes(language)) {
    jsTests(index, scan);
    jsMocks(index, scan);
  } else if (language === "rust") {
    rustTests(index, scan);
    rustMocks(index, scan);
  } else if (language === "java") {
    jvmTests(index, language, scan);
    javaMocks(index, scan);
  } else if (language === "kotlin") {
    jvmTests(index, language, scan);
    kotlinMocks(index, scan);
  } else if (language === "cpp" || language === "c") {
    cppTests(index, scan);
    cppMocks(index, scan);
    if (language === "c") cTests(index, scan, path);
  } else if (language in OTHERS) OTHERS[language](index, scan, path);
  return scan;
}

// src/treesitter/analyzer.ts
function unavailable(language, status, message) {
  return {
    profile: PARSE_VERSION,
    language,
    parser_status: status,
    parser_message: message,
    metrics: null,
    declarations: [],
    top_level: [],
    references: [],
    diagnostics: [{ kind: status === "unsupported" ? "unsupported" : "resource", message, location: null }],
    truncated: { declarations: false, references: false, diagnostics: false },
    package: null,
    mocks: []
  };
}
var CONTAINERS = /* @__PURE__ */ new Set([
  "class_definition",
  "class_declaration",
  "class_specifier",
  "struct_specifier",
  "object_declaration",
  "object_definition",
  "trait_definition",
  "record_declaration",
  "enum_declaration",
  "interface_declaration",
  "namespace_definition",
  "impl_item",
  "mod_item",
  "object_literal",
  "protocol_declaration",
  "extension_declaration",
  // Ruby's class and module.
  "class",
  "module"
]);
function testHolders(root, cases, suites, index) {
  const key = (node) => `${node.startIndex}:${node.endIndex}`;
  const suite = new Set(suites.map((item) => `${item.start}:${item.end}`));
  const holderOf = (node) => {
    if (node.type === "TestDecl") return node;
    for (let parent = node.parent; parent; parent = parent.parent) if (!parent.parent || CONTAINERS.has(parent.type) || suite.has(key(parent))) return parent;
    return root;
  };
  const held = /* @__PURE__ */ new Set();
  for (const node of [...cases.keys(), ...suite].flatMap((span3) => index.spanned(span3))) {
    for (let holder = holderOf(node); holder && !held.has(key(holder)); holder = holder.parent && holder.type !== "mod_item" ? holderOf(holder) : null) {
      held.add(key(holder));
    }
  }
  return held;
}
function supportsTests(node, held, language) {
  for (let parent = node.parent; parent; parent = parent.parent) if (held.has(`${parent.startIndex}:${parent.endIndex}`)) return true;
  const decorated = language === "python" && node.parent?.type === "decorated_definition" ? node.parent : null;
  return Boolean(decorated?.namedChildren.some((item) => item.type === "decorator" && /^@(?:pytest\.)?fixture\b/.test(item.text)));
}
function declarationsOf(items, nodes, language, nonblank, cases, blockMacros, held, index) {
  const result = [];
  const found = (node) => cases.get(`${node.startIndex}:${node.endIndex}`) ?? null;
  const renamed = (node) => found(node)?.qualified ?? null;
  const parentId = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (parent.startIndex !== node.startIndex && (isFunction(parent) || found(parent))) return `function:${parent.startIndex}`;
    return null;
  };
  for (const item of items) {
    if (["Function", "Method", "Constructor"].includes(item.kind?.type ?? "")) {
      const span3 = item.span;
      const node = nodes.get(`${span3.startByte}:${span3.endByte}`);
      if (!node) throw new Error(`No syntax node for declaration ${item.name} at ${span3.startByte}`);
      if ((language === "c" || language === "cpp") && node.type === "declaration") continue;
      if (hasSyntaxError(node, blockMacros, index)) {
        result.push(...declarationsOf(item.children ?? [], nodes, language, nonblank, cases, blockMacros, held, index));
        continue;
      }
      const test = found(node);
      result.push({
        id: `function:${node.startIndex}`,
        kind: "function",
        syntax_kind: node.type,
        name: test?.test.name ?? (["kotlin", "cpp", "solidity", "lua"].includes(language) ? functionName(node) : item.name ?? "<anonymous>"),
        qualified_name: qualifiedFunctionName(node, renamed),
        parent_function: parentFunctionName(node, renamed),
        parent_id: parentId(node),
        function_depth: functionDepth(node),
        line: span3.startLine + 1,
        end_line: Math.max(span3.startLine + 1, span3.endLine + (span3.endColumn > 0 ? 1 : 0)),
        location: location(node),
        metrics: qualityMetrics(measure(node, true, nonblank, index), measureComplexity(node, language, true, index)),
        test: test?.test ?? null,
        internal: internalLinkage(node, language),
        params: parametersOf(node),
        ...decoratorsOf(node, language).length ? { decorators: decoratorsOf(node, language) } : {},
        ...!test && supportsTests(node, held, language) ? { support: true } : {},
        // `fun String.size()` is a top-level function called as a member of whatever receiver it names, not a class's method.
        ...language === "kotlin" && node.childForFieldName("receiver") ? { extension: true } : {}
      });
    }
    result.push(...declarationsOf(item.children ?? [], nodes, language, nonblank, cases, blockMacros, held, index));
  }
  return result;
}
function decoratorsOf(node, language) {
  if (language !== "python" || node.parent?.type !== "decorated_definition") return [];
  return node.parent.namedChildren.filter((item) => item.type === "decorator").map((item) => item.text.replace(/^@/, "").split("(")[0].trim()).filter(Boolean);
}
function pythonDocstring(node) {
  if (node.type === "string") return /^[ru]?["']/i.test(node.text);
  const parts = node.namedChildren.filter((item) => !isComment(item));
  return ["expression_statement", "parenthesized_expression", "concatenated_string"].includes(node.type) && parts.length > 0 && parts.every(pythonDocstring);
}
function pythonStub(node) {
  if (node.type !== "function_definition") return false;
  if (decoratorsOf(node, "python").some((name) => name === "overload" || name === "typing.overload")) return true;
  const body = node.childForFieldName("body")?.namedChildren.filter((item) => !isComment(item)) ?? [];
  return body.length > 0 && body.every((item, index) => item.type === "pass_statement" || item.type === "ellipsis" || item.type === "expression_statement" && item.namedChildren.length === 1 && item.namedChildren[0].type === "ellipsis" || index === 0 && pythonDocstring(item));
}
var lastLine = (node) => node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0);
function onlyCloses(root, line, around) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.startPosition.row + 1 > line || lastLine(node) < line || node.endIndex <= node.startIndex || isComment(node)) continue;
    if (node.childCount) {
      for (let index = 0; index < node.childCount; index++) stack.push(node.child(index));
      continue;
    }
    if (node.isNamed || /\w/.test(node.text) && !around.has(node.parent?.id ?? "")) return false;
  }
  return true;
}
function topLevelLines(root, declarations, nodes, lines, stubs) {
  const held = /* @__PURE__ */ new Set(), around = /* @__PURE__ */ new Set(), ends = /* @__PURE__ */ new Set();
  const covered = declarations.filter((item) => isNamed(item.qualified_name)).map((item) => nodes.get(`${item.location.start.byte}:${item.location.end.byte}`));
  covered.push(...stubs.map((node) => node.parent?.type === "decorated_definition" ? node.parent : node));
  for (const node of covered) {
    for (let line = node.startPosition.row + 1; line <= lastLine(node); line++) held.add(line);
    let parent = node.parent;
    for (; parent && parent.id !== root.id && !around.has(parent.id); parent = parent.parent) {
      around.add(parent.id);
      held.add(parent.startPosition.row + 1);
      ends.add(lastLine(parent));
    }
  }
  for (const line of ends) if (!held.has(line) && onlyCloses(root, line, around)) held.add(line);
  return Array.from({ length: lines }, (_, index) => index + 1).filter((line) => !held.has(line));
}
function analysisOf(root, language, built, path) {
  const nodes = /* @__PURE__ */ new Map();
  const structure = [...built.structure ?? []];
  const wanted = /* @__PURE__ */ new Set();
  const remember = (items) => {
    for (const item of items) {
      wanted.add(`${item.span.startByte}:${item.span.endByte}`);
      remember(item.children ?? []);
    }
  };
  remember(structure);
  const references = referenceVisitor(language), functions = [];
  const index = walk(root, [references, { enter: (node) => {
    if (isFunction(node)) functions.push(node);
  } }]);
  const tests = findTests(root, language, path, index);
  const declare = (node) => {
    const start = node.startPosition, end = node.endPosition;
    structure.push({
      kind: { type: "Function" },
      name: functionName(node),
      span: { startByte: node.startIndex, endByte: node.endIndex, startLine: start.row, endLine: end.row, startColumn: start.column, endColumn: end.column },
      children: []
    });
    wanted.add(`${node.startIndex}:${node.endIndex}`);
  };
  for (const body of tests.bodies) if (!wanted.has(`${body.startIndex}:${body.endIndex}`)) declare(body);
  for (const node of functions) if (!wanted.has(`${node.startIndex}:${node.endIndex}`)) declare(node);
  for (const key of wanted) {
    const same = index.spanned(key);
    if (same.length) nodes.set(key, same[same.length - 1]);
  }
  const syntaxError = hasSyntaxError(root, tests.blockMacros, index);
  const nonblank = nonblankRows(root);
  const held = testHolders(root, tests.cases, tests.suites, index);
  const stubs = language === "python" ? functions.filter(pythonStub) : [];
  const stubIds = new Set(stubs.flatMap((node) => index.within(node).filter(isFunction).map((item) => `function:${item.startIndex}`)));
  const declarations = declarationsOf(structure, nodes, language, nonblank, tests.cases, tests.blockMacros, held, index).filter((item) => !stubIds.has(item.id)).sort((a, b) => a.location.start.byte - b.location.start.byte);
  const diagnostics = (syntaxError ? built.diagnostics ?? [] : []).map((item) => ({
    kind: "syntax",
    message: item.message,
    location: item.span ? {
      start: { line: item.span.startLine + 1, column: item.span.startColumn + 1, byte: item.span.startByte },
      end: { line: item.span.endLine + 1, column: item.span.endColumn + 1, byte: item.span.endByte }
    } : null
  }));
  const measurement = measure(root, false, nonblank, index);
  measurement.sloc = built.metrics.codeLines;
  measurement.comment_lines = built.metrics.commentLines;
  if (syntaxError && !diagnostics.length) diagnostics.push({ kind: "syntax", message: "Syntax error in source", location: location(root) });
  return {
    profile: PARSE_VERSION,
    language,
    parser_status: syntaxError && !declarations.length ? "parse-error" : "parsed",
    parser_message: diagnostics[0]?.message ?? null,
    metrics: qualityMetrics(measurement, measureComplexity(root, language, false, index)),
    declarations,
    top_level: topLevelLines(root, declarations, nodes, root.endPosition.row + 1, stubs),
    // The pack's import records do not expose every binding/alias or call site. This extractor adds those graph edges.
    references: references.finish(index).filter((item) => !stubIds.has(item.source)),
    diagnostics,
    truncated: { declarations: false, references: false, diagnostics: false },
    has_tests: tests.cases.size > 0,
    package: tests.package,
    mocks: tests.mocks.filter((item) => !stubIds.has(item.owner)),
    default_export: defaultExport(root, language),
    suites: tests.suites
  };
}
var DEFAULT_EXPORTERS = /* @__PURE__ */ new Set(["javascript", "typescript", "tsx"]);
var NAMED_DECLARATIONS = /* @__PURE__ */ new Set(["function_declaration", "generator_function_declaration", "class_declaration", "function_expression", "class"]);
function defaultExport(root, language) {
  if (language === "lua") {
    const returned = root.namedChildren.filter((item) => item.type === "return_statement").at(-1)?.namedChildren[0]?.namedChildren[0];
    return returned?.type === "identifier" ? returned.text : null;
  }
  if (!DEFAULT_EXPORTERS.has(language)) return null;
  const named2 = (node) => node?.type === "identifier" ? node.text : node && NAMED_DECLARATIONS.has(node.type) ? node.childForFieldName("name")?.text ?? null : null;
  for (const item of root.namedChildren) {
    if (item.type === "export_statement" && Array.from({ length: item.childCount }, (_, index) => item.child(index)).some((part) => part?.type === "default")) {
      const found = named2(item.childForFieldName("declaration")) ?? named2(item.childForFieldName("value"));
      if (found) return found;
    }
    let assignment = item.type === "expression_statement" ? item.namedChildren[0] : null, exported = false;
    while (assignment?.type === "assignment_expression") {
      exported ||= assignment.childForFieldName("left")?.text === "module.exports";
      const right = assignment.childForFieldName("right");
      if (right?.type !== "assignment_expression") {
        const found = exported ? named2(right) : null;
        if (found) return found;
        break;
      }
      assignment = right;
    }
  }
  return null;
}
var LanguagePackAnalyzer = class {
  async analyzeSource(source, language, options = {}) {
    const normalized = normalizeLanguage(language);
    if (!normalized) return unavailable(language, "unsupported", `No language-pack grammar is registered for ${language}`);
    try {
      const parser = downloading(() => pack_default.getParser(normalized));
      const tree = parser.parse(source);
      if (!tree) throw new Error("Language pack returned no syntax tree");
      const built = downloading(() => pack_default.process(source, { language: normalized, structure: true, imports: true, diagnostics: true }));
      return analysisOf(new Node(tree.rootNode(), Buffer.from(source)), normalized, built, options.path ?? null);
    } catch (error) {
      return unavailable(normalized, "resource-unavailable", error instanceof Error ? error.message : String(error));
    }
  }
  async analyzeSummary(source, language, options = {}) {
    const { declarations, top_level: _topLevel, references: _references, ...summary } = await this.analyzeSource(source, language, options);
    return { ...summary, declaration_count: declarations.length };
  }
};
function createAnalyzer() {
  return new LanguagePackAnalyzer();
}

// src/store.js
import { createHash as createHash3, randomUUID } from "node:crypto";

// src/git.js
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return stdout;
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim();
    const failure = new Error(`git ${args.filter((arg) => !arg.startsWith("-c") || arg.length > 2).join(" ")} failed: ${detail}`);
    failure.stdout = error.stdout?.toString() ?? "";
    throw failure;
  }
}
async function listTree(root, rev) {
  const text3 = await git(["ls-tree", "-r", "-l", "-z", rev], root);
  return text3.split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d+) (\w+) ([0-9a-f]+) +(\d+|-)\t(.*)$/s.exec(entry);
    if (!match) throw new Error(`Unexpected ls-tree entry: ${entry}`);
    return { mode: match[1], type: match[2], sha: match[3], size: match[4] === "-" ? 0 : Number(match[4]), path: match[5] };
  });
}
var readBlob = (root, sha2) => git(["cat-file", "blob", sha2], root);

// src/ask.js
var import_yaml = __toESM(require_dist(), 1);
import { readFileSync as readFileSync2 } from "node:fs";
import { createHash as createHash2 } from "node:crypto";

// src/languages.js
var languages = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  // Sprockets reads a file's extensions right to left as the steps that build it, so a Rails app's ES2015 module is `name.js.es6`
  // and its last extension is es6. Discourse has hundreds of them.
  es6: "javascript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sc: "scala",
  groovy: "groovy",
  gradle: "groovy",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "c_sharp",
  rb: "ruby",
  rake: "ruby",
  php: "php",
  phtml: "php",
  lua: "lua",
  swift: "swift",
  zig: "zig",
  sol: "solidity",
  sh: "bash",
  bash: "bash",
  bats: "bash"
};
var CPP = new Set(Object.keys(languages).filter((extension) => languages[extension] === "cpp"));
var languageOf = (path, header = "c") => {
  const extension = path.split(".").at(-1);
  return extension === "h" ? header : languages[extension];
};
var fileLanguages = {
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  toml: "toml",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  xml: "xml",
  svg: "xml",
  ini: "ini",
  cfg: "ini",
  sql: "sql",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  vue: "vue",
  svelte: "svelte",
  ex: "elixir",
  exs: "elixir",
  dart: "dart"
};
var namedFiles = { Dockerfile: "dockerfile", Makefile: "make", "CMakeLists.txt": "cmake", Gemfile: "ruby", Rakefile: "ruby" };
var LANGUAGES = [.../* @__PURE__ */ new Set([...Object.values(languages), ...Object.values(fileLanguages), ...Object.values(namedFiles)])].sort();

// src/ask.js
var SHAPES = ["noul", "choice", "score"];
var EACH = ["file", "method", "test"];
var SEES = ["self", "file", "calls", "callers", "neighbors"];
function isContextPath(context) {
  if (typeof context !== "string") return false;
  const path = context.trim();
  if (path === "" || path.startsWith("/")) return false;
  if (path.split("/").includes("..")) return false;
  return !/[*?[\]{}\\]/.test(path);
}
var ENSURES = ["ensure", "ensure_present", "ensure_absent"];
var SEARCHES = (kind) => kind === "ensure_present" || kind === "ensure_absent";
var KEYS = /* @__PURE__ */ new Set(["name", "disabled", "min", "gate", "type", "each", "where", "language", "except", "sees", "context", "ask", "true", "false", "options", "levels", "when", "issue", ...ENSURES]);
var ISSUE_KEYS = /* @__PURE__ */ new Set(["type", "label", "on", "pick", "except"]);
function expand(rule) {
  const kind = ENSURES.find((key) => rule[key]);
  if (!kind) return rule;
  const text3 = String(rule[kind]).replace(/\s+/g, " ").trim();
  const searching = SEARCHES(kind);
  return {
    ...rule,
    kind,
    text: text3,
    type: "noul",
    ask: searching ? "Is `looking_for` here, in the code below? Answer about this code alone; somewhere else having it is not this." : "Is `rule` true of the code below?",
    true: text3,
    false: searching ? `Not here: ${text3}` : `Not so: ${text3}`,
    // A present rule is broken by finding nothing anywhere, which no single unit's answer decides, so the search reads the
    // answers itself. An absent rule and a plain ensure are broken by one unit, and say so the ordinary way. A rule that
    // declares its own issue keeps it: the shorthand is for the wording, not a ceiling on what the answer may mean.
    issue: rule.issue ?? (kind === "ensure_present" ? null : { type: "lint", label: "self", on: kind !== "ensure_absent" ? false : true })
  };
}
var gates = (question) => question.gate === void 0 ? Boolean(question.issue) || SEARCHES(question.kind) : question.gate;
var percentage = (value) => typeof value !== "object" && Number(value) >= 0 && Number(value) <= 100;
function floorsOf(min, where) {
  if (min === void 0 || min === null) return null;
  if (typeof min !== "object" || Array.isArray(min)) {
    if (!percentage(min)) throw new Error(`${where}: min is a percentage, 0 to 100, or a map of model id prefixes to one, not ${min}`);
    return Number(min);
  }
  if (!Object.hasOwn(min, "default")) throw new Error(`${where}: a min map needs a default for the models it does not name`);
  const wrong = Object.entries(min).filter(([, value]) => !percentage(value)).map(([prefix]) => prefix);
  if (wrong.length) throw new Error(`${where}: min for ${wrong.join(", ")} is not a percentage, 0 to 100`);
  return Object.fromEntries(Object.entries(min).map(([prefix, value]) => [prefix, Number(value)]));
}
function check(question, at, noun = "question") {
  if (!question?.name) throw new Error(`${at}: every ${noun} needs a name`);
  const where = `${question.name} (${at})`;
  const extra = Object.keys(question).filter((key) => !KEYS.has(key));
  if (extra.length) throw new Error(`${where}: ${extra.join(", ")} is not a key; the keys are ${[...KEYS].join(", ")}`);
  if (question.disabled) return { name: question.name, disabled: true, declared: question, at, type: null, kind: null, text: null, hash: "off" };
  const full = expand(question);
  const type = full.type ?? "noul";
  if (!SHAPES.includes(type)) throw new Error(`${where}: type is ${SHAPES.join(", ")}, not ${type}`);
  if (full.each && !EACH.includes(full.each)) throw new Error(`${where}: each is ${EACH.join(", ")}, not ${full.each}`);
  if (!full.where && full.each !== "test") throw new Error(`${where}: needs where to say what it applies to`);
  const languages2 = [full.language ?? []].flat();
  if (full.language !== void 0 && !languages2.length) throw new Error(`${where}: language is a language name or a nonempty list of language names`);
  const unknown = languages2.filter((language) => !LANGUAGES.includes(language));
  if (unknown.length) throw new Error(`${where}: ${unknown.join(", ")} is not a language perch parses; use ${LANGUAGES.join(", ")}`);
  const each = full.each ?? (full.kind ? "file" : "method");
  if (full.sees && !SEES.includes(full.sees)) throw new Error(`${where}: sees is ${SEES.join(", ")}, not ${full.sees}`);
  if (full.sees && each === "method") throw new Error(`${where}: a method is always asked with its callers and callees in view, so sees says nothing here`);
  if (full.context !== void 0 && !isContextPath(full.context))
    throw new Error(`${where}: context is a file name, or a path from the repository root, not ${JSON.stringify(full.context)}`);
  if (full.context && !full.kind) throw new Error(`${where}: context needs one of ${ENSURES.join(", ")}`);
  const sees = full.sees ?? (each === "method" && full.context ? "neighbors" : "self");
  if (!full.ask) throw new Error(`${where}: needs ask, or one of ${ENSURES.join(", ")}`);
  if (type === "noul" && (full.true === void 0 || full.false === void 0)) throw new Error(`${where}: a noul needs true and false`);
  if (type === "choice" && !full.options) throw new Error(`${where}: a choice needs options`);
  if (type === "score" && !Array.isArray(full.levels)) throw new Error(`${where}: a score needs levels, weakest first`);
  const min = floorsOf(full.min, where);
  if (full.gate !== void 0 && typeof full.gate !== "boolean") throw new Error(`${where}: gate is true or false, not ${full.gate}`);
  if (full.issue) {
    const unknown2 = Object.keys(full.issue).filter((key) => !ISSUE_KEYS.has(key));
    if (unknown2.length) throw new Error(`${where}: issue takes ${[...ISSUE_KEYS].join(", ")}, not ${unknown2.join(", ")}`);
    if (!full.issue.type) throw new Error(`${where}: an issue needs a type`);
  }
  return {
    ...full,
    type,
    each,
    sees,
    min,
    gate: gates(full),
    context: full.context?.trim() ?? null,
    kind: full.kind ?? null,
    text: full.text ?? null,
    at,
    // As it was written, so a question perch ships can be copied into your own file and changed from there.
    declared: question,
    // A search's kind is in its hash. ensure_present and ensure_absent ask the same question and read the answer opposite ways,
    // and an absent rule's checks are kept per unit where they were once one row for the whole search, so a check kept from one
    // shape is not an answer in the other. The document's name is in it only when there is one, so a rule without one keeps the
    // hash it had before the key existed.
    hash: sha(JSON.stringify([
      full.ask,
      full.true,
      full.false,
      full.options,
      full.levels,
      full.where,
      full.language,
      full.except,
      full.each,
      full.sees,
      ...SEARCHES(full.kind) ? [full.kind] : [],
      ...full.context ? [full.context.trim()] : []
    ]))
  };
}
var sha = (text3) => createHash2("sha256").update(text3).digest("hex");
function parseQuestions(text3, at, noun = "question") {
  const doc = text3.trim() ? (0, import_yaml.parse)(text3) : [];
  const list = Array.isArray(doc) ? doc : doc?.rules ?? (doc && typeof doc === "object" && ("ignore" in doc || "scan_types" in doc) ? [] : void 0);
  if (!Array.isArray(list)) throw new Error(`${at}: expected a list of ${noun}s, or a map with rules: under it`);
  return list.map((question, index) => check(question, `${at} ${noun} ${index + 1}`, noun));
}
var SCAN_YAML = readFileSync2(new URL("../scan.yaml", import.meta.url), "utf8");
var BUILTIN = parseQuestions(SCAN_YAML, "scan.yaml");

// src/exclusions.js
var directories = /* @__PURE__ */ new Set([
  ".git",
  ".perch",
  ".lakeday",
  "vendor",
  "node_modules",
  "dist",
  "target",
  "build",
  "coverage",
  "out",
  "third_party",
  "third-party",
  "thirdparty",
  "3rdparty",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".angular",
  ".parcel-cache",
  ".turbo",
  ".vite",
  ".npm",
  ".pnpm-store",
  "bower_components",
  "jspm_packages",
  "web_modules",
  "storybook-static",
  ".docusaurus",
  ".nyc_output",
  ".venv",
  "venv",
  "site-packages",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".eggs",
  "htmlcov",
  ".gradle",
  ".bloop",
  ".metals",
  ".scala-build",
  ".cxx",
  ".externalNativeBuild",
  "CMakeFiles",
  "_deps",
  "bazel-bin",
  "bazel-out",
  "bazel-testlogs",
  ".build",
  "Pods",
  "DerivedData",
  ".zig-cache",
  "zig-cache",
  "zig-out",
  ".dart_tool",
  ".pub-cache",
  ".pub",
  ".stack-work",
  "dist-newstyle",
  ".cabal-sandbox",
  "_build",
  ".elixir_ls",
  "lua_modules",
  "blib",
  ".precomp",
  ".cpcache",
  ".godot",
  ".import"
]);
var subdirectories = /* @__PURE__ */ new Set([
  ".yarn/cache",
  ".yarn/unplugged",
  ".vitepress/cache",
  ".vitepress/dist",
  "Carthage/Build",
  "Carthage/Checkouts",
  "renv/library",
  "renv/staging",
  "packrat/lib",
  "packrat/lib-ext",
  ".clj-kondo/.cache",
  "Godeps/_workspace"
]);
function eligibleFile(item) {
  if (item.type !== "blob" || /\.min\.(?:[cm]?[jt]s|[jt]sx)$/.test(item.path)) return false;
  const parts = item.path.split("/");
  return !parts.slice(0, -1).some((part, index) => directories.has(part) || /^cmake-build-.+/.test(part) || subdirectories.has(`${parts[index - 1]}/${part}`));
}
function createFileSelector(tree, attributes4 = []) {
  const generated = /* @__PURE__ */ new Set();
  const add = (root, names2) => {
    for (const name of names2) generated.add(root + name);
  };
  for (const item of tree) {
    if (!eligibleFile(item)) continue;
    const path = item.path, slash = path.lastIndexOf("/"), root = path.slice(0, slash + 1), name = path.slice(slash + 1);
    if (/\.(?:cs|fs|vb)proj$/i.test(name)) add(root, ["bin", "Bin", "obj", "Obj"]);
    if (name === "mix.exs" || name === "rebar.config") add(root, ["deps"]);
    if (/^hardhat\.config\.(?:[cm]?js|[cm]?ts)$/.test(name)) add(root, ["cache", "artifacts"]);
    if (name === "foundry.toml") add(root, ["cache", "broadcast"]);
    if (/(^|\/)ProjectSettings\/ProjectVersion\.txt$/.test(path))
      add(path.slice(0, -"ProjectSettings/ProjectVersion.txt".length), ["Library", "Temp", "Obj", "Logs", "UserSettings", "Builds"]);
    if (name.endsWith(".uproject")) add(root, ["Binaries", "Intermediate", "Saved"]);
    if (name === "pyvenv.cfg" && root) generated.add(root.slice(0, -1));
  }
  return (item) => {
    const declared2 = declaredGenerated(attributes4, item.path);
    if (declared2 !== void 0) return item.type === "blob" && !declared2;
    if (!eligibleFile(item)) return false;
    const parts = item.path.split("/");
    let parent = "";
    for (const part of parts.slice(0, -1)) {
      parent = parent ? `${parent}/${part}` : part;
      if (generated.has(parent)) return false;
    }
    return true;
  };
}
function declaredGenerated(attributes4, path) {
  const state = {};
  for (const rule of attributes4) if (rule.match(path)) Object.assign(state, rule.values);
  const values = ["linguist-generated", "linguist-vendored"].map((name) => state[name]).filter((value) => value !== void 0);
  return values.length ? values.some(Boolean) : void 0;
}
var GENERATED_MARKERS = [
  /^\s*(?:\/\/|#|--|;|\/\*+|\*)\s*Code generated\b.*\bDO NOT EDIT\b/i,
  /^\s*(?:\/\/|#|--|\/\*+|\*)\s*@generated\b/,
  /Generated by the protocol buffer compiler\.\s+DO NOT EDIT!/,
  /GENERATED CODE -- DO NOT EDIT!/,
  /^\s*\/\/ Generated by the gRPC/,
  /Autogenerated by Thrift Compiler/,
  /DO NOT EDIT THIS FILE - it is machine generated/,
  /Generated by Cython/
];
var MINIFIABLE = /\.(?:[cm]?js|css)$/i;
function generatedText(path, text3) {
  const lines = String(text3).split("\n");
  if (MINIFIABLE.test(path)) {
    if (lines.length && lines.reduce((total, line) => total + line.length, 0) / lines.length > 110) return "minified";
    if (lines.slice(-2).some((line) => /^\/[*/][#@] source(?:Mapping)?URL|sourceURL=/.test(line))) return "source map";
  }
  return lines.slice(0, 40).some((line) => GENERATED_MARKERS.some((marker) => marker.test(line))) ? "generated" : null;
}

// src/tokens.js
var MAX_CHOICES = 128;
var contextLimits = (length) => Object.freeze({ state: Math.floor(length * 0.8), single: Math.floor(length * 0.96), request: length });
var JEV_TOKENS = Object.freeze({ state: 24e3, single: 3e4, request: 6e4 });
var DECISIONS_TOKENS = contextLimits(25e4);
var MODEL_TOKEN_LIMITS = Object.freeze({ jev: JEV_TOKENS, "gpt-6-luna": DECISIONS_TOKENS, perch: DECISIONS_TOKENS });
var TOKEN_LIMITS = Object.freeze({ ...JEV_TOKENS, questions: Infinity, options: MAX_CHOICES });

// src/chunks.js
var WINDOW_BYTES = 256 * 1024;

// src/questions.js
var STATE_BUDGET = TOKEN_LIMITS.state;
var commentLine = /^\s*(\/\/|\/\*|\*|#|"""|''')/;
function leadingComment(lines, line) {
  const block = [];
  for (let index = line - 2; index >= 0 && (commentLine.test(lines[index]) || block.length && !lines[index].trim()); index--) block.unshift(lines[index]);
  return block.join("\n").trim();
}
function shownSource(lines, line, endLine) {
  const comment2 = leadingComment(lines, line);
  return (comment2 ? `${comment2}
` : "") + lines.slice(line - 1, endLine).join("\n");
}

// src/store.js
var sha256 = (text3) => createHash3("sha256").update(text3).digest("hex");

// src/analysis.js
function createSourceAnalyzer() {
  return createAnalyzer();
}
var sourceFile = (item) => eligibleFile(item) && Boolean(languageOf(item.path));
var holdsOnlyTests = (methods, hasTests = methods.some((method) => method.test)) => hasTests && methods.every((method) => method.node === null || method.test || method.support);
var trim = (metrics) => metrics ? { risk_score: metrics.risk_score, maintainability_index: metrics.maintainability_index, cyclomatic_complexity: metrics.cyclomatic_complexity, max_nesting: metrics.max_nesting, sloc: metrics.sloc } : null;
var comment = (text3) => /^\s*(\/\/|\/\*|\*|#(?!\s*define)|"""|''')/.test(text3);
var isCode = (text3) => Boolean(text3.trim()) && !comment(text3) && !/^\s*(import|from|use|package)\b|^\s*#\s*include\b/.test(text3);
var TOP_LEVEL = "<top-level>";
function methodsOf(path, analysis, lines) {
  const seen = /* @__PURE__ */ new Map(), methods = [];
  const add = (method, shown) => {
    const base = `${path}::${method.qualified_name}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    methods.push({ id: count > 1 ? `${base}#${count}` : base, ...method, hash: sha256(shown) });
  };
  for (const declaration of analysis.declarations) {
    if (!isNamed(declaration.qualified_name)) continue;
    const name = declaration.name === "<anonymous>" ? declaration.qualified_name.split(".").at(-1) : declaration.name;
    add(
      {
        node: declaration.id,
        name,
        qualified_name: declaration.qualified_name,
        line: declaration.line,
        end_line: declaration.end_line,
        metrics: trim(declaration.metrics),
        branches: declaration.metrics?.branch_lines ?? [],
        ...declaration.test ? { test: declaration.test } : {},
        ...declaration.internal ? { internal: true } : {},
        ...declaration.support ? { support: true } : {},
        ...declaration.extension ? { extension: true } : {},
        ...declaration.params?.length ? { params: declaration.params } : {},
        ...declaration.decorators?.length ? { decorators: declaration.decorators } : {}
      },
      shownSource(lines, declaration.line, declaration.end_line)
    );
  }
  const described = /* @__PURE__ */ new Set();
  for (const method of methods) for (let line = method.line - 1; line >= 1 && comment(lines[line - 1]); line--) described.add(line);
  const outside = (analysis.top_level ?? []).filter((line) => !described.has(line));
  const code = outside.filter((line) => isCode(lines[line - 1] ?? ""));
  if (code.length) {
    const own = outside.filter((line) => line >= code[0] && line <= code.at(-1));
    add({ node: null, name: TOP_LEVEL, qualified_name: TOP_LEVEL, line: code[0], end_line: code.at(-1), lines: own, metrics: null }, own.map((line) => lines[line - 1]).join("\n"));
  }
  return methods;
}
function ownerAt(spans, byte) {
  let owner = null;
  for (const span3 of spans) {
    if (span3.start <= byte && byte < span3.end && (!owner || span3.end - span3.start < owner.end - owner.start)) owner = span3;
  }
  return owner?.id ?? null;
}
var FRAMEWORK_CALLS = /* @__PURE__ */ new Set([
  "describe",
  "context",
  "suite",
  "it",
  "test",
  "specify",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "before",
  "after",
  "vi",
  "jest",
  "expect",
  // RSpec, Minitest, Pest and busted spell their hooks and stubs in their own words.
  "let",
  "let!",
  "subject",
  "allow",
  "receive",
  "double",
  "instance_double",
  "setup",
  "teardown",
  "uses",
  "before_each",
  "after_each",
  "lazy_setup",
  "strict_setup",
  "insulate",
  "expose",
  "spec",
  "pending",
  "stub",
  "spy",
  "mock",
  "assert",
  "RSpec"
]);
var heldBy = (reference) => reference.held ?? null;
function namedFunctions(held, byNode) {
  if (!held) return null;
  if (held.fn) return byNode.has(held.fn) ? { fn: byNode.get(held.fn) } : null;
  if (held.fields) {
    const fields = Object.fromEntries(Object.entries(held.fields).map(([key, value]) => [key, namedFunctions(value, byNode)]).filter(([, value]) => value));
    return Object.keys(fields).length ? { fields } : null;
  }
  return held.on ? { ...held, on: namedFunctions(held.on, byNode) ?? void 0 } : held;
}
function fileRecord(file, source, analysis) {
  const methods = methodsOf(file.path, analysis, source.split("\n"));
  const byNode = new Map(methods.map((method) => [method.node, method.id]));
  const parents = new Map(analysis.declarations.map((declaration) => [declaration.id, declaration.parent_id]));
  const spans = analysis.declarations.filter((declaration) => byNode.has(declaration.id)).map((declaration) => ({ id: byNode.get(declaration.id), start: declaration.location.start.byte, end: declaration.location.end.byte }));
  const top = methods.find((method) => method.node === null), topLines = new Set(top?.lines ?? []);
  const declared2 = new Map(analysis.declarations.map((declaration) => [declaration.id, declaration]));
  for (const method of methods) {
    for (let id = method.node && declared2.get(method.node)?.parent_id; id; id = declared2.get(id)?.parent_id ?? null) {
      if (byNode.has(id)) {
        method.parent = byNode.get(id);
        break;
      }
    }
  }
  const ownerOf2 = (source2, byte, line) => {
    if (source2 !== "file") {
      for (let id = source2; id; id = parents.get(id) ?? null) if (byNode.has(id)) return byNode.get(id);
    }
    return (byte === null ? null : ownerAt(spans, byte)) ?? (topLines.has(line) ? top.id : null);
  };
  const suites = analysis.suites ?? [];
  const testIds = new Set(methods.filter((method) => method.test).map((method) => method.id)), testSpans = spans.filter((span3) => testIds.has(span3.id));
  const setupFor = (byte) => {
    const around = suites.filter((suite) => suite.start <= byte && byte < suite.end);
    return around.length ? testSpans.filter((span3) => around.some((suite) => suite.start <= span3.start && span3.end <= suite.end)).map((span3) => span3.id) : [];
  };
  const calls = analysis.references.filter((reference) => reference.kind === "call" && reference.name !== "<dynamic>").flatMap((reference) => {
    const byte = reference.location.start.byte, from = ownerOf2(reference.source, byte, reference.line);
    const setup = (!from || from === top?.id) && !FRAMEWORK_CALLS.has(reference.name.split(".")[0]) ? setupFor(byte) : [];
    const via = reference.held ?? null;
    const args = reference.args?.map((held) => namedFunctions(held, byNode) ?? null), named2 = reference.named && Object.fromEntries(Object.entries(reference.named).map(([key, held]) => [key, namedFunctions(held, byNode)]).filter(([, held]) => held));
    return (setup.length ? setup : [from]).filter(Boolean).map((owner) => ({
      name: reference.name,
      from: owner,
      line: reference.line,
      ...via ? { via } : {},
      ...args?.some(Boolean) ? { args } : {},
      ...named2 && Object.keys(named2).length ? { named: named2 } : {}
    }));
  });
  for (const method of methods) {
    if (!method.test?.setup) continue;
    for (const name of method.test.setup) calls.push({ name, from: method.id, line: method.line });
    method.test = { ...method.test };
    delete method.test.setup;
  }
  const values = analysis.references.filter((reference) => reference.kind === "value").map((reference) => ({ name: reference.name, from: ownerOf2(reference.source, reference.location.start.byte, reference.line), line: reference.line })).filter((value) => value.from);
  const seen = /* @__PURE__ */ new Set();
  const reads = analysis.references.filter((reference) => reference.kind === "read").map((reference) => ({ name: reference.name, from: ownerOf2(reference.source, reference.location.start.byte, reference.line), line: reference.line, ...reference.held ? { via: reference.held } : {} })).filter((read) => read.from && !seen.has(`${read.from}:${read.name}`) && seen.add(`${read.from}:${read.name}`));
  const binds = analysis.references.filter((reference) => reference.kind === "bind").map((reference) => ({ name: reference.name, ...namedFunctions(heldBy(reference), byNode) ?? {}, from: ownerOf2(reference.source, reference.location.start.byte, reference.line) }));
  for (const reference of analysis.references.filter((reference2) => reference2.kind === "returns")) {
    const owner = methods.find((method) => method.id === ownerOf2(reference.source, reference.location.start.byte, reference.line));
    const held = namedFunctions(heldBy(reference), byNode);
    if (owner && owner.node !== null && held) {
      if (!owner.returns) owner.returns = held;
      else if (!owner.yields) owner.yields = held;
    }
  }
  const extended2 = {};
  for (const reference of analysis.references.filter((reference2) => reference2.kind === "extends")) (extended2[reference.name] ??= []).push(reference.reference);
  const imports2 = analysis.references.filter((reference) => reference.kind === "import" && reference.imported_name).map((reference) => ({ module: reference.module, name: reference.imported_name, alias: reference.alias ?? reference.imported_name, ...reference.reexport ? { reexport: true } : {} }));
  const mocks = (analysis.mocks ?? []).map((mock) => ({ owner: mock.owner === "file" ? "file" : ownerOf2(mock.owner, null, null) ?? "file", target: mock.target, line: mock.line }));
  const test = holdsOnlyTests(methods, analysis.has_tests);
  return {
    path: file.path,
    blob: file.sha,
    language: file.language ?? languageOf(file.path),
    test,
    metrics: trim(analysis.metrics),
    methods,
    calls,
    values,
    reads,
    imports: imports2,
    package: analysis.package ?? null,
    mocks,
    ...analysis.default_export ? { default_export: analysis.default_export } : {},
    ...binds.length ? { binds } : {},
    ...Object.keys(extended2).length ? { bases: extended2 } : {}
  };
}
async function parseFile(file, source, analyzer) {
  const analysis = await analyzer.analyzeSource(source, file.language ?? languageOf(file.path), { path: file.path });
  const diagnostic = { path: file.path, status: analysis.parser_status, message: analysis.parser_message, diagnostics: analysis.diagnostics?.slice(0, 8) };
  if (analysis.parser_status !== "parsed") return { failed: diagnostic };
  return {
    record: fileRecord(file, source, analysis),
    functions: analysis.declarations.length,
    risk: analysis.metrics?.risk_score ?? null,
    ...analysis.diagnostics?.length ? { noted: diagnostic } : {}
  };
}
var CHILD_FLAG = "--perch-parse-child";
if (process.argv.includes(CHILD_FLAG) && process.send) {
  const analyzer = createAnalyzer();
  process.on("message", async ({ index, file, source }) => {
    let result;
    try {
      result = await parseFile(file, source, analyzer);
    } catch (error) {
      result = { failed: { path: file.path, status: "resource-unavailable", message: error.message } };
    }
    process.send({ index, result });
  });
}
var BUNDLED = import.meta.url.endsWith(".mjs");
var PARALLEL_FROM = 200;
var generatedBy = (file, source) => !file.authored && generatedText(file.path, source) !== null;
async function readAll(files, { analyzer, readSource, workers, progress }) {
  const results = new Array(files.length);
  let functions = 0;
  const done = (index, result) => {
    results[index] = result;
    functions += result.functions ?? 0;
    progress(functions, null);
  };
  if (workers < 2 || !BUNDLED || files.length < PARALLEL_FROM) {
    for (const [index, file] of files.entries()) {
      const source = await readSource(file, index);
      progress(functions, null);
      if (generatedBy(file, source)) {
        done(index, { generated: true });
        continue;
      }
      await new Promise((resolve) => setImmediate(resolve));
      done(index, await parseFile(file, source, analyzer));
    }
    return results;
  }
  const pool = Array.from({ length: Math.min(workers, files.length) }, () => fork(fileURLToPath(import.meta.url), [CHILD_FLAG], { serialization: "advanced" }));
  let next = 0;
  try {
    await Promise.all(pool.map((child2) => new Promise((resolve, reject) => {
      const send = async () => {
        if (next >= files.length) {
          resolve();
          return;
        }
        const index = next++, source = await readSource(files[index], index);
        if (generatedBy(files[index], source)) {
          done(index, { generated: true });
          await send();
          return;
        }
        child2.send({ index, file: files[index], source });
      };
      child2.on("message", ({ index, result }) => {
        done(index, result);
        send().catch(reject);
      });
      child2.on("error", reject);
      child2.on("exit", (code) => {
        if (next < files.length || results.includes(void 0)) reject(new Error(`a parsing process exited with ${code}`));
      });
      send().catch(reject);
    })));
  } finally {
    for (const child2 of pool) child2.kill();
  }
  return results;
}
async function analyzeFiles(files, { analyzer, readSource, progress = () => {
}, debug = () => {
}, workers = 0 }) {
  const coverage = { supported: files.length, parsed: 0, parse_failures: 0, parser_diagnostics: [] };
  let functions = 0;
  const analyzed = [], candidates = [];
  for (const result of await readAll(files, { analyzer, readSource, workers, progress })) {
    if (result.generated) {
      coverage.generated = (coverage.generated ?? 0) + 1;
      continue;
    }
    if (result.failed) {
      coverage.parse_failures++;
      if (coverage.parser_diagnostics.length < 20) coverage.parser_diagnostics.push(result.failed);
      continue;
    }
    coverage.parsed++;
    if (result.noted) {
      coverage.parsed_with_errors = (coverage.parsed_with_errors ?? 0) + 1;
      if (coverage.parser_diagnostics.length < 20) coverage.parser_diagnostics.push(result.noted);
    }
    functions += result.functions;
    const { record } = result;
    debug(`analyzed ${record.path} (risk ${result.risk?.toFixed?.(1) ?? "?"}, ${record.methods.length} methods)`);
    analyzed.push(record);
    if (!record.test) {
      for (const method of record.methods) if (!method.test) candidates.push({ id: method.id, score: method.metrics?.risk_score ?? 0 });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { coverage, functions, files: analyzed, candidates };
}

// src/graph.js
import { dirname as dirname2, posix } from "node:path";
var extensions = ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rs", "go"];
var normalize = (path) => posix.normalize(path).replace(/^\.\//, "");
var parentDir = (dir) => dir === "." ? null : dirname2(dir) === "." ? "." : dirname2(dir);
var ancestors = (path) => {
  const dirs = [];
  for (let dir = dirname2(path); dir; dir = parentDir(dir)) dirs.push(dir);
  return dirs;
};
var firstExisting = (paths, candidates) => candidates.map(normalize).find((path) => paths.has(path)) ?? null;
var resolvePython = (fromPath, module, paths) => {
  const dots = module.length - module.replace(/^\.+/, "").length;
  const rest = module.slice(dots).split(".").filter(Boolean).join("/");
  const dirs = ancestors(fromPath), starts = dots ? [dirs[dots - 1]] : [...new Set([".", ...dirs].flatMap((dir) => [dir, dir === "." ? "src" : `${dir}/src`]))];
  if (dots && !starts[0]) return null;
  return firstExisting(paths, starts.flatMap((start) => rest ? [`${start}/${rest}.py`, `${start}/${rest}/__init__.py`] : [`${start}/__init__.py`]));
};
var directoryModules = /* @__PURE__ */ new Set(["mod.rs", "lib.rs", "main.rs"]);
var childrenOf = (path) => directoryModules.has(posix.basename(path)) ? dirname2(path) : path.replace(/\.rs$/, "");
var resolveRust = (fromPath, module, paths, crates = []) => {
  const has = (path) => paths.has(normalize(path)), parts = module.split("::");
  let dir = childrenOf(fromPath), file = null, names2 = parts;
  const crate = crates.find((item) => item.name === parts[0]);
  if (crate) {
    if (!has(crate.lib)) return null;
    [dir, file, names2] = [dirname2(crate.lib), normalize(crate.lib), parts.slice(1)];
  } else if (parts[0] === "crate") {
    const dirs = ancestors(fromPath), root = dirs.find((dir2) => has(`${dir2}/src/lib.rs`) || has(`${dir2}/src/main.rs`)) ?? ((dir2) => dir2 && parentDir(dir2))(dirs.find((dir2) => dir2.endsWith("/src") || dir2 === "src"));
    if (!root) return null;
    [dir, file, names2] = [`${root}/src`, firstExisting(paths, [`${root}/src/lib.rs`, `${root}/src/main.rs`]), parts.slice(1)];
  } else if (parts[0] === "self" || parts[0] === "super") {
    [file, names2] = [fromPath, parts[0] === "self" ? parts.slice(1) : parts];
    for (; names2[0] === "super"; names2 = names2.slice(1)) {
      dir = parentDir(dir);
      if (!dir) return null;
      file = firstExisting(paths, [`${dir}.rs`, `${dir}/mod.rs`, `${dir}/lib.rs`, `${dir}/main.rs`]);
    }
  }
  for (const name of names2) {
    const child2 = firstExisting(paths, [`${dir}/${name}.rs`, `${dir}/${name}/mod.rs`]);
    if (!child2) break;
    [dir, file] = [`${dir}/${name}`, child2];
  }
  return file;
};
var byTail = /* @__PURE__ */ new WeakMap();
function resolveInclude(fromPath, module, paths) {
  const beside = normalize(posix.join(dirname2(fromPath), module));
  if (paths.has(beside)) return beside;
  if (!byTail.has(paths)) {
    const named2 = /* @__PURE__ */ new Map();
    for (const path of paths) {
      const base = path.split("/").at(-1);
      named2.set(base, [...named2.get(base) ?? [], path]);
    }
    byTail.set(paths, named2);
  }
  const found = (byTail.get(paths).get(module.split("/").at(-1)) ?? []).filter((path) => path === module || path.endsWith(`/${module}`));
  return found.length === 1 ? found[0] : null;
}
var resolveBash = (fromPath, module, paths) => {
  if (module.startsWith("/")) return null;
  const beside = normalize(posix.join(dirname2(fromPath), module)), rooted = normalize(module);
  return firstExisting(paths, [beside, `${beside}.bash`, `${beside}.sh`, rooted, `${rooted}.bash`, `${rooted}.sh`]);
};
var resolveSolidity = (fromPath, module, paths) => {
  if (module.startsWith(".")) return firstExisting(paths, [posix.join(dirname2(fromPath), module)]);
  const [head, ...rest] = module.split("/");
  return firstExisting(paths, ancestors(fromPath).flatMap((dir) => {
    const at = dir === "." ? "" : `${dir}/`;
    return [`${at}${module}`, `${at}lib/${head}/src/${rest.join("/")}`, `${at}lib/${module}`];
  }));
};
var RUBY_LOAD_PATH = ["lib", "test", "spec"];
function resolveRuby(fromPath, module, paths) {
  const stem = module.replace(/\.rb$/, "");
  if (/^\.\.?\//.test(stem)) return firstExisting(paths, [`${posix.join(dirname2(fromPath), stem)}.rb`, `${stem.replace(/^\.\//, "")}.rb`]);
  const dirs = [".", ...ancestors(fromPath)];
  return firstExisting(paths, dirs.flatMap((dir) => RUBY_LOAD_PATH.map((root) => `${dir}/${root}/${stem}.rb`)));
}
var LUA_ROOTS = ["", "src", "lua"];
function resolveLua(module, paths) {
  const rest = module.split(".").join("/");
  return firstExisting(paths, LUA_ROOTS.flatMap((root) => [`${root}/${rest}.lua`, `${root}/${rest}/init.lua`]));
}
function resolvePhp(fromPath, module, paths) {
  return firstExisting(paths, [posix.join(dirname2(fromPath), module), module]);
}
function resolveModule(fromPath, module, language, paths, crates = []) {
  if (typeof module !== "string") return null;
  if (language === "python") return resolvePython(fromPath, module, paths);
  if (language === "rust") return resolveRust(fromPath, module, paths, crates);
  if (language === "c" || language === "cpp") return resolveInclude(fromPath, module, paths);
  if (language === "bash") return resolveBash(fromPath, module, paths);
  if (language === "zig") return module.endsWith(".zig") ? firstExisting(paths, [posix.join(dirname2(fromPath), module)]) : null;
  if (language === "solidity") return resolveSolidity(fromPath, module, paths);
  if (language === "ruby") return resolveRuby(fromPath, module, paths);
  if (language === "lua") return resolveLua(module, paths);
  if (language === "php") return resolvePhp(fromPath, module, paths);
  if (!module.startsWith(".")) return null;
  const base = normalize(posix.join(dirname2(fromPath), module)), stem = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
  return firstExisting(paths, [base, ...extensions.map((ext) => `${stem}.${ext}`), ...extensions.map((ext) => `${base}/index.${ext}`)]);
}
var JAVASCRIPT = /* @__PURE__ */ new Set(["javascript", "typescript", "tsx"]);
var CONSTRUCTORS = { python: ["__init__"], javascript: ["constructor"], typescript: ["constructor"], tsx: ["constructor"], solidity: ["constructor"], swift: ["init"], scala: ["apply"], ruby: ["initialize"], php: ["__construct"], lua: ["new"] };
var constructorOf = (language, name) => CONSTRUCTORS[language]?.[0] ?? name;
var PACKAGED = /* @__PURE__ */ new Set(["java", "kotlin", "scala", "c_sharp", "php"]);
var TOP_LEVEL_FUNCTIONS = /* @__PURE__ */ new Set(["kotlin", "scala", "php"]);
var NATIVE = /* @__PURE__ */ new Set(["c", "cpp"]);
var IMPLICIT_THIS = /* @__PURE__ */ new Set(["java", "kotlin", "cpp", "c_sharp", "scala", "swift", "dart", "solidity", "zig", "ruby"]);
var PASSES_IMPORTS = /* @__PURE__ */ new Set(["rust", "python", "zig", "ruby"]);
var UNIFORM_ACCESS = /* @__PURE__ */ new Set(["scala", "javascript", "typescript", "tsx", "python"]);
var USING_NAMESPACE = "<namespace>";
var USING_NAME = "<using>";
var RECEIVERS = /* @__PURE__ */ new Set(["this", "self", "cls", "Self"]);
var ZIG_TEST_NAMESPACES = /* @__PURE__ */ new Set(["test", "decltest"]);
var basesOf2 = (file, name) => file?.bases && Object.hasOwn(file.bases, name) ? file.bases[name] : null;
function buildGraph(files, { crates = [], modules = [], focus = null } = {}) {
  const nodes = /* @__PURE__ */ new Map(), byPath = /* @__PURE__ */ new Map(), paths = new Set(files.map((file) => file.path));
  const resolved = /* @__PURE__ */ new Map();
  const resolveIn = (from, module, language, known) => {
    if (known !== paths) return resolveModule(from, module, language, known, crates);
    const key = `${language}\0${language === "python" ? dirname2(from) : from}\0${module}`;
    if (!resolved.has(key)) resolved.set(key, resolveModule(from, module, language, paths, crates));
    return resolved.get(key);
  };
  for (const file of files) {
    const byQualified = /* @__PURE__ */ new Map(), sameName = /* @__PURE__ */ new Map();
    for (const method of file.methods) {
      nodes.set(method.id, { ...method, path: file.path, language: file.language, test: Boolean(file.test) || Boolean(method.test) || Boolean(method.support), case: method.test ?? null });
      if (!byQualified.has(method.qualified_name)) byQualified.set(method.qualified_name, method.id);
      if (!sameName.has(method.qualified_name)) sameName.set(method.qualified_name, []);
      sameName.get(method.qualified_name).push(method.id);
    }
    byPath.set(file.path, { file, byQualified, sameName });
  }
  const overloadsOf = (to, call = null) => {
    const node = nodes.get(to);
    const all = node ? byPath.get(node.path)?.sameName.get(node.qualified_name) ?? [] : [];
    if (all.length < 2) return [];
    const count = call?.args ? call.args.length + Object.keys(call.named ?? {}).length : null;
    return all.filter((id) => id !== to && (count === null || !nodes.get(id).params?.length || nodes.get(id).params.length >= count));
  };
  const subclassesOf = /* @__PURE__ */ new Map();
  for (const file of files) {
    for (const [name, bases] of Object.entries(file.bases ?? {})) {
      for (const base of bases) {
        const key = String(base).split(/::|\./).at(-1);
        if (!subclassesOf.has(key)) subclassesOf.set(key, []);
        subclassesOf.get(key).push({ path: file.path, name });
      }
    }
  }
  const overridesOf = (to, depth = 0, seen = /* @__PURE__ */ new Set()) => {
    const node = nodes.get(to);
    if (!node || depth > 3 || seen.has(to)) return [];
    seen.add(to);
    const parts = node.qualified_name.split(".");
    if (parts.length < 2) return [];
    const member = parts.at(-1), owner = parts.at(-2);
    const found = [];
    for (const sub of subclassesOf.get(owner) ?? []) {
      const entry = byPath.get(sub.path);
      const suffix = `${sub.name}.${member}`;
      for (const [qualified, id] of entry?.byQualified ?? []) {
        if (id === to || !(qualified === suffix || qualified.endsWith(`.${suffix}`))) continue;
        found.push(id, ...overloadsOf(id), ...overridesOf(id, depth + 1, seen));
      }
    }
    return found;
  };
  const defined = (path, qualified) => byPath.get(path)?.byQualified.get(qualified) ?? null;
  const exact = (path, qualified) => {
    const own = defined(path, qualified);
    if (own) return own;
    const names2 = [...CONSTRUCTORS[byPath.get(path)?.file.language] ?? [], qualified.split(".").at(-1)];
    for (const name of names2) {
      const found = defined(path, `${qualified}.${name}`);
      if (found) return found;
    }
    return null;
  };
  const scopesOf = (path, from) => {
    const node = nodes.get(from);
    const parts = (node?.qualified_name ?? "").split(".").filter(Boolean);
    if (node?.case && node.language === "zig" && parts.length >= 2 && ZIG_TEST_NAMESPACES.has(parts.at(-2))) parts.splice(parts.length - 2, 1);
    const scopes = [];
    for (let length = parts.length; length > 0; length -= 1) {
      const name = parts.slice(0, length).join(".");
      scopes.push({ name, callable: Boolean(defined(path, name)) });
    }
    return scopes;
  };
  const throughGlobs = (file, qualified) => {
    for (const glob of (file.imports ?? []).filter((item) => item.name === "*" && (!item.alias || item.alias === "*") && !item.reexport)) {
      const module = resolveIn(file.path, glob.module, file.language, paths);
      const through = module && exported(module, qualified, file.language);
      if (through) return through;
    }
    return null;
  };
  const rubyConstant = (file, parts, from) => {
    const named2 = parts.at(-1) === "new" && parts.length > 1 ? [...parts.slice(0, -1), "initialize"] : parts;
    const qualified = named2.join(".");
    for (const prefix of [...scopesOf(file.path, from).filter((scope) => !scope.callable).map((scope) => scope.name), ""]) {
      const name = prefix ? `${prefix}.${qualified}` : qualified;
      const found = exact(file.path, name) ?? throughGlobs(file, name);
      if (found) return found;
    }
    return null;
  };
  const unqualified = (file, name, from) => {
    for (const scope of scopesOf(file.path, from)) {
      if (!scope.callable && !IMPLICIT_THIS.has(file.language)) continue;
      const found = exact(file.path, `${scope.name}.${name}`);
      if (found) return found;
    }
    return exact(file.path, name) ?? inClosure(file.path, name) ?? inheritedBare(file, name, from);
  };
  const inheritedBare = (file, name, from) => {
    if (!IMPLICIT_THIS.has(file.language)) return null;
    const owner = scopesOf(file.path, from).find((scope) => !scope.callable);
    return owner ? inherited(file, { name: owner.name.split(".").at(-1), path: file.path }, name, 0) : null;
  };
  const closures = /* @__PURE__ */ new Map();
  const inClosure = (path, name) => {
    if (!closures.has(path)) {
      const named2 = /* @__PURE__ */ new Map();
      for (const id of byPath.get(path)?.byQualified.values() ?? []) {
        const qualified = nodes.get(id)?.qualified_name ?? "";
        if (!qualified.includes("<anonymous>.")) continue;
        const last = qualified.split(".").at(-1);
        named2.set(last, [...named2.get(last) ?? [], id]);
      }
      closures.set(path, named2);
    }
    const found = closures.get(path).get(name) ?? [];
    return found.length === 1 ? found[0] : null;
  };
  const ownClass = (file, name, from) => {
    const owner = scopesOf(file.path, from).find((scope) => !scope.callable);
    return owner ? exact(file.path, `${owner.name}.${name}`) ?? inherited(file, { name: owner.name.split(".").at(-1), path: file.path }, name, 0) : null;
  };
  const single = (paths2, qualified) => {
    const ids = new Set(paths2.map((path) => byPath.get(path)?.byQualified.get(qualified)).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : null;
  };
  const packages = /* @__PURE__ */ new Map(), importable = /* @__PURE__ */ new Map();
  const packageKey = (file) => `${dirname2(file.path)}\0${file.package ?? ""}`;
  for (const file of files) {
    if (file.language !== "go") continue;
    const key = packageKey(file), directory = dirname2(file.path);
    if (!packages.has(key)) packages.set(key, /* @__PURE__ */ new Map());
    if (!importable.has(directory)) importable.set(directory, /* @__PURE__ */ new Map());
    const names2 = packages.get(key), exported2 = importable.get(directory), entry = byPath.get(file.path);
    for (const [name, id] of entry.byQualified) {
      if (!names2.has(name)) names2.set(name, []);
      names2.get(name).push({ file, id });
      if (!(file.package ?? "").endsWith("_test") && !exported2.has(name)) exported2.set(name, id);
    }
  }
  const samePackage = (file, name) => packages.get(packageKey(file))?.get(name)?.find((entry) => entry.file !== file)?.id ?? null;
  const inPackage = (directory, name) => importable.get(directory)?.get(name) ?? null;
  const goPackageDir = (module) => {
    const owner = modules.filter((item) => module === item.path || module.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!owner) return null;
    const directory = [owner.dir, module.slice(owner.path.length).replace(/^\//, "")].filter(Boolean).join("/");
    return directory === "" ? "." : directory;
  };
  const pythonModule = (file, parts, least) => {
    for (let length = parts.length - least; length > 0; length -= 1) {
      const target = resolveIn(file.path, parts.slice(0, length).join("."), "python", paths);
      if (target) return { target, rest: parts.slice(length) };
    }
    return null;
  };
  const inModule = (target, rest) => rest.length === 1 ? resolve(byPath.get(target).file, rest[0], null) : exported(target, rest.join("."), byPath.get(target).file.language);
  const submodule = (imported) => imported.module.endsWith(".") || !imported.module ? `${imported.module}${imported.name}` : `${imported.module}.${imported.name}`;
  const exported = (target, qualified, language, depth = 0) => {
    const module = byPath.get(target)?.file;
    const own = exact(target, qualified) ?? (JAVASCRIPT.has(language) ? exact(target, `exports.${qualified}`) ?? exact(target, `module.exports.${qualified}`) : null) ?? (module?.language === "lua" && module.default_export ? exact(target, `${module.default_export}.${qualified}`) : null);
    if (own || !module || depth > 4) return own;
    const [head, ...more] = qualified.split(".");
    for (const item of module.imports ?? []) {
      if (!item.reexport && !PASSES_IMPORTS.has(module.language)) continue;
      const next2 = resolveIn(target, item.module, module.language, paths);
      if (!next2) continue;
      if (item.name === "*" && (!item.alias || item.alias === "*")) {
        const found = exported(next2, qualified, language, depth + 1);
        if (found) return found;
      } else if (item.alias === head) {
        const name = item.name === "default" || item.name === "*" && !more.length ? byPath.get(next2)?.file.default_export : item.name;
        const whole = byPath.get(next2)?.file.default_export;
        const found = item.name === "*" && more.length ? exported(next2, more.join("."), language, depth + 1) ?? (whole && JAVASCRIPT.has(language) ? exported(next2, [whole, ...more].join("."), language, depth + 1) : null) : name ? exported(next2, [name, ...more].join("."), language, depth + 1) : null;
        if (found) return found;
      }
    }
    const passed = JAVASCRIPT.has(language) && module.default_export === head ? (module.imports ?? []).find((item) => item.alias === head && !item.reexport) : null;
    const next = passed && resolveIn(target, passed.module, module.language, paths);
    if (next) {
      const name = passed.name === "default" || passed.name === "*" ? byPath.get(next)?.file.default_export : passed.name;
      return name ? exported(next, [name, ...more].join("."), language, depth + 1) : null;
    }
    return null;
  };
  const passedOn = (target, depth = 0) => {
    const file = target && byPath.get(target)?.file;
    if (!file || depth > 4 || !JAVASCRIPT.has(file.language) || file.default_export) return target;
    const whole = (file.imports ?? []).filter((item) => item.name === "*" && item.alias === "*" && !item.reexport).map((item) => resolveIn(target, item.module, file.language, paths)).filter(Boolean);
    return whole.length === 1 ? passedOn(whole[0], depth + 1) : target;
  };
  const viaImport = (file, parts) => {
    const [alias, ...rest] = parts, tail = rest.at(-1) ?? null;
    const imported = file.imports.find((item) => item.alias === alias && !item.reexport);
    if (!imported) return null;
    if (file.language === "go") {
      const directory = rest.length ? goPackageDir(imported.module) : null;
      return directory === null ? null : inPackage(directory, rest.join("."));
    }
    if (file.language === "python" && rest.length) {
      if (imported.name === "*") {
        const bound = imported.alias === imported.module.split(".")[0] ? [imported.alias] : imported.module.split(".");
        const found = pythonModule(file, [...bound, ...rest], 1);
        return found ? inModule(found.target, found.rest) : null;
      }
      const module = resolveIn(file.path, submodule(imported), "python", paths);
      if (module) return inModule(module, rest);
    }
    if (file.language === "rust" && rest.length) {
      const module = resolveIn(file.path, `${imported.module}::${imported.name}`, "rust", paths);
      if (module && module !== resolveIn(file.path, imported.module, "rust", paths)) return exact(module, rest.join("."));
    }
    const target = passedOn(resolveIn(file.path, imported.module, file.language, paths));
    if (!target) return null;
    const fallback = byPath.get(target)?.file.default_export ?? null;
    const own = imported.name === "default" || imported.name === "*" && tail === null ? fallback : imported.name;
    const defined2 = (qualified) => exported(target, qualified, file.language);
    if (tail === null) return own ? defined2(own) : null;
    return imported.name === "*" ? defined2(rest.join(".")) : own ? defined2([own, ...rest].join(".")) : null;
  };
  const jvm = /* @__PURE__ */ new Map();
  const jvmPackage = (name) => {
    if (!jvm.has(name)) jvm.set(name, { classes: /* @__PURE__ */ new Map(), functions: /* @__PURE__ */ new Map(), extensions: /* @__PURE__ */ new Map() });
    return jvm.get(name);
  };
  for (const file of files) {
    if (!PACKAGED.has(file.language)) continue;
    const entry = jvmPackage(file.package ?? "");
    for (const method of file.methods) {
      if (method.extension) {
        if (!entry.extensions.has(method.name)) entry.extensions.set(method.name, /* @__PURE__ */ new Set());
        entry.extensions.get(method.name).add(method.id);
        continue;
      }
      const dot = method.qualified_name.indexOf(".");
      const [map, key, value] = dot > 0 ? [entry.classes, method.qualified_name.slice(0, dot), file.path] : [entry.functions, method.qualified_name, method.id];
      if (!map.has(key)) map.set(key, /* @__PURE__ */ new Set());
      map.get(key).add(value);
    }
  }
  const sole = (ids) => new Set(ids).size === 1 ? ids[0] : null;
  const classesIn = (name, head) => [...jvm.get(name)?.classes.get(head) ?? []];
  const functionsIn = (name, head) => [...jvm.get(name)?.functions.get(head) ?? []];
  const extensionsIn = (name, member) => [...jvm.get(name)?.extensions.get(member) ?? []];
  const ownPackages = (file) => {
    if (file.language !== "c_sharp") return [file.package ?? ""];
    const parts = (file.package ?? "").split(".").filter(Boolean);
    return parts.map((_, index) => parts.slice(0, parts.length - index).join(".")).concat("");
  };
  const jvmExtension = (file, member, receiver = null) => {
    const imports2 = file.imports ?? [];
    const on = (ids) => receiver ? ids.filter((id) => nodes.get(id)?.qualified_name === `${receiver}.${member}`) : ids;
    const explicit = imports2.find((item) => item.alias === member && item.name !== "*" && !item.name.endsWith(".*"));
    if (explicit) return sole(on(extensionsIn(explicit.module, explicit.name)));
    const own = on(extensionsIn(file.package ?? "", member));
    if (own.length) return sole(own);
    return sole(on(imports2.filter((item) => item.name === "*").flatMap((item) => extensionsIn(item.module, member))));
  };
  const classFiles = (file, head) => {
    const imports2 = file.imports ?? [];
    const named2 = imports2.find((item) => item.alias === head && item.name !== "*" && !item.name.includes("."));
    if (named2) return classesIn(named2.module, named2.name);
    for (const name of ownPackages(file)) {
      const own = classesIn(name, head);
      if (own.length) return own;
    }
    const onDemand = imports2.filter((item) => item.name === "*").flatMap((item) => classesIn(item.module, head));
    return onDemand.length ? onDemand : null;
  };
  const declaredName = (file, head) => (file.imports ?? []).find((item) => item.alias === head && item.name !== "*" && !item.name.includes("."))?.name ?? head;
  const namespacedFiles = (file, head) => {
    const absolute = head.startsWith("\\"), segments = head.replace(/^\\/, "").split("\\"), name = segments.pop();
    const namespace = absolute || !file.package ? segments.join("\\") : `${file.package}\\${segments.join("\\")}`;
    const found = classesIn(namespace, name);
    return found.length ? { files: found, name } : null;
  };
  const jvmConstructor = (file, name) => {
    const files2 = classFiles(file, name), declared2 = declaredName(file, name);
    return files2 ? single(files2, `${declared2}.${constructorOf(file.language, declared2)}`) : null;
  };
  const jvmQualified = (file, parts) => {
    if (file.language === "php" && parts[0].includes("\\")) {
      const found = namespacedFiles(file, parts[0]);
      return found ? single(found.files, [found.name, ...parts.slice(1)].join(".")) : void 0;
    }
    const files2 = classFiles(file, parts[0]);
    return files2 === null ? void 0 : single(files2, [declaredName(file, parts[0]), ...parts.slice(1)].join("."));
  };
  const jvmUnqualified = (file, name) => {
    const kotlin = TOP_LEVEL_FUNCTIONS.has(file.language), php = file.language === "php", functions = kotlin, imports2 = file.imports ?? [];
    const explicit = imports2.find((item) => item.alias === name && item.name !== "*" && !item.name.endsWith(".*"));
    if (explicit) {
      const [owner, member] = explicit.name.split(".");
      if (member) return single(classesIn(explicit.module, owner), `${owner}.${member}`);
      return functions ? sole(functionsIn(explicit.module, explicit.name)) : null;
    }
    const own = functions ? functionsIn(file.package ?? "", name) : [];
    if (own.length) return sole(own);
    if (php && file.package) {
      const global = functionsIn("", name);
      if (global.length) return sole(global);
    }
    const onDemand = imports2.flatMap((item) => {
      if (item.name === "*") return kotlin ? functionsIn(item.module, name) : [];
      if (!item.name.endsWith(".*")) return [];
      const owner = item.name.slice(0, -2);
      return [single(classesIn(item.module, owner), `${owner}.${name}`)].filter(Boolean);
    });
    return sole(onDemand);
  };
  const swiftModuleOf = (path) => {
    for (let dir = dirname2(path); ; dir = dirname2(dir)) {
      const root = dir === "." ? "" : dir;
      if (paths.has(root ? `${root}/Package.swift` : "Package.swift")) {
        const target = /^(?:Sources|Tests)\/([^/]+)\//.exec(root ? path.slice(root.length + 1) : path);
        return `${root}/${target ? target[1] : ""}`;
      }
      if (dir === ".") return "/";
    }
  };
  const swift = /* @__PURE__ */ new Map();
  for (const file of files) {
    if (file.language !== "swift") continue;
    const module = swiftModuleOf(file.path);
    if (!swift.has(module)) swift.set(module, { classes: /* @__PURE__ */ new Map(), functions: /* @__PURE__ */ new Map() });
    const entry = swift.get(module);
    for (const method of file.methods) {
      const dot = method.qualified_name.indexOf(".");
      const [map, key, value] = dot > 0 ? [entry.classes, method.qualified_name.slice(0, dot), file.path] : [entry.functions, method.qualified_name, method.id];
      if (!map.has(key)) map.set(key, /* @__PURE__ */ new Set());
      map.get(key).add(value);
    }
  }
  const swiftModulesOf = (file) => [
    swiftModuleOf(file.path),
    ...(file.imports ?? []).filter((item) => item.name === "*").flatMap((item) => [...swift.keys()].filter((module) => module.split("/").at(-1) === item.module))
  ];
  const swiftClassFiles = (file, head) => {
    for (const module of swiftModulesOf(file)) {
      const found = [...swift.get(module)?.classes.get(head) ?? []];
      if (found.length) return found;
    }
    return null;
  };
  const swiftUnqualified = (file, name) => {
    for (const module of swiftModulesOf(file)) {
      const found = [...swift.get(module)?.functions.get(name) ?? []];
      if (found.length) return sole(found);
    }
    const files2 = swiftClassFiles(file, name);
    return files2 ? single(files2, `${name}.init`) : null;
  };
  const swiftQualified = (file, parts) => {
    const files2 = swiftClassFiles(file, parts[0]);
    return files2 === null ? void 0 : single(files2, parts.join("."));
  };
  const linkage = /* @__PURE__ */ new Map();
  for (const file of files) {
    if (!NATIVE.has(file.language)) continue;
    for (const method of file.methods) {
      if (method.internal) continue;
      if (!linkage.has(method.qualified_name)) linkage.set(method.qualified_name, []);
      linkage.get(method.qualified_name).push(method.id);
    }
  }
  const linked = (from, parts, file = null, constructors = true) => {
    const scopes = (nodes.get(from)?.qualified_name ?? "").split(".").slice(0, -1);
    const imports2 = file?.imports ?? [];
    const used = imports2.filter((item) => item.name === USING_NAMESPACE).map((item) => item.module.split("::"));
    for (const item of imports2.filter((item2) => item2.name === USING_NAME)) {
      const path = item.module.split("::");
      if (path.length > 1 && path.at(-1) === parts[0]) used.push(path.slice(0, -1));
    }
    for (const shape of constructors ? [parts, [...parts, parts.at(-1)]] : [parts]) {
      for (let depth = scopes.length; depth >= 0; depth -= 1) {
        const ids = linkage.get([...scopes.slice(0, depth), ...shape].join("."));
        if (ids) return ids.length === 1 ? ids[0] : null;
      }
      for (const namespace of used) {
        const ids = linkage.get([...namespace, ...shape].join("."));
        if (ids) return ids.length === 1 ? ids[0] : null;
      }
    }
    return null;
  };
  const resolve = (file, name, from, depth = 0, via = null) => {
    const parts = name.split(/::|\./), head = parts[0], tail = parts.at(-1);
    const native = NATIVE.has(file.language) && !name.includes(".");
    if (parts.length === 1) {
      return viaImport(file, parts) ?? unqualified(file, name, from) ?? throughGlobs(file, name) ?? (file.language === "python" && depth <= 3 ? viaBinding(file, name, "__call__", from, depth) : null) ?? (file.language === "go" ? samePackage(file, name) : null) ?? (PACKAGED.has(file.language) ? jvmUnqualified(file, name) ?? jvmConstructor(file, name) : null) ?? (file.language === "kotlin" ? jvmExtension(file, name) : null) ?? (file.language === "swift" ? swiftUnqualified(file, name) : null) ?? (native ? linked(from, parts, file) : null);
    }
    if (file.language === "php" && head.includes("\\")) return jvmQualified(file, parts) ?? null;
    const variant = file.language === "rust" ? /^(?:.*::)?([A-Z]\w*)::[A-Z]\w*\.(\w+)$/.exec(name) : /^(?:.*\.)?([A-Z]\w*)\.[A-Z][A-Z\d_]*\.(\w+)$/.exec(name);
    if (variant) {
      const found = memberOf2(file, { name: variant[1] }, variant[2]);
      if (found) return found;
    }
    if (head === "$receiver" && via && depth <= 3) {
      const kind = classOf(file, via, from, depth + 1);
      const found = kind && memberOf2(file, kind, tail);
      if (found) return found;
    }
    if (RECEIVERS.has(head) && parts.length === 2) return ownClass(file, tail, from) ?? (file.language === "python" && depth <= 3 ? viaBinding(file, `this.${tail}`, "__call__", from, depth) : null);
    if (parts.length === 2 || parts.length === 3 && RECEIVERS.has(head)) {
      const held = depth > 3 ? null : viaBinding(file, parts.length === 3 ? `this.${parts[1]}` : head, tail, from, depth);
      if (held) return held;
    }
    if (RECEIVERS.has(head)) return null;
    const imported = viaImport(file, parts) ?? exact(file.path, parts.join(".")) ?? throughGlobs(file, parts.join("."));
    if (imported) return imported;
    if (file.language === "go" && parts.length === 2) {
      const own = samePackage(file, name);
      if (own) return own;
    }
    if (file.language === "ruby") {
      const constant = rubyConstant(file, parts, from);
      if (constant) return constant;
    }
    if (file.language === "rust" && name.includes("::")) {
      for (let length = parts.length - 1; length >= 1; length--) {
        const module = resolveIn(file.path, parts.slice(0, length).join("::"), "rust", paths);
        const found = module ? exported(module, parts.slice(length).join("."), "rust") : null;
        if (found) return found;
      }
    }
    if (PACKAGED.has(file.language)) {
      const member = jvmQualified(file, parts);
      if (member !== void 0 && member !== null) return member;
      if (file.language === "kotlin" && parts.length === 2) {
        const extension = jvmExtension(file, tail);
        if (extension) return extension;
      }
      if (file.language === "scala" && parts.length >= 3 && depth <= 3) {
        const kind = classOf(file, { call: parts.slice(0, -1).join(".") }, from, depth + 1);
        const found = kind && memberOf2(file, kind, tail);
        if (found) return found;
      }
      if (member !== void 0) return member;
    }
    if (file.language === "swift") {
      const member = swiftQualified(file, parts);
      if (member !== void 0) return member;
    }
    return native ? linked(from, parts, file) : null;
  };
  const refersToItself = (held, name) => Boolean(held) && (held.local === name || (held.call ?? "").startsWith(`${name}.`) || refersToItself(held.on, name));
  const bindingFor = (file, name, from) => {
    const all = (file.binds ?? []).filter((item) => item.name === name && !refersToItself(item, name));
    const field = IMPLICIT_THIS.has(file.language) && name.startsWith("this.") ? (file.binds ?? []).filter((item) => item.name === name.slice(5)) : [];
    if (!all.length && !field.length) return null;
    const caller = nodes.get(from)?.qualified_name ?? "";
    const scope = (id) => nodes.get(id)?.qualified_name ?? "";
    const classOfCaller = caller.split(".").slice(0, -1).join(".");
    const atTopLevel = (item) => !item.from || scope(item.from) === "<top-level>";
    return all.find((item) => item.from === from) ?? all.find((item) => item.from && caller.startsWith(`${scope(item.from)}.`)) ?? (name.startsWith("this.") ? all.find((item) => item.from && classOfCaller && scope(item.from).split(".").slice(0, -1).join(".") === classOfCaller) : null) ?? all.find(atTopLevel) ?? field.find(atTopLevel) ?? null;
  };
  const bindingElsewhere = (file, name, from, depth = 0) => {
    const caller = (nodes.get(from)?.qualified_name ?? "").split(".");
    if (name.startsWith("this.") && caller.length > 1 && depth < 4) {
      const at = classFile(file, { name: caller.at(-2), path: file.path });
      for (const base of basesOf2(at, caller.at(-2)) ?? []) {
        const baseFile = classFile(at, { name: base.split(/::|\./).at(-1) });
        const held = baseFile && (baseFile.binds ?? []).find((item) => item.name === name && (nodes.get(item.from)?.qualified_name ?? "").split(".").at(-2) === base.split(/::|\./).at(-1));
        if (held) return { held, file: baseFile };
      }
    }
    if (file.language === "python" && !name.includes(".")) {
      const dirs = [];
      for (let dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""; ; dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "") {
        dirs.push(dir);
        if (!dir) break;
      }
      for (const path of [file.path, ...dirs.map((dir) => dir ? `${dir}/conftest.py` : "conftest.py")]) {
        if (path !== file.path && !byPath.has(path)) continue;
        if (defined(path, name)) return { held: { call: name }, file: byPath.get(path).file, from: defined(path, name) };
      }
    }
    return null;
  };
  const calledWith = /* @__PURE__ */ new Map();
  const remember = (file, call, to) => {
    if (!call.args && !call.named) return;
    if (!calledWith.has(to)) calledWith.set(to, []);
    calledWith.get(to).push({ file, from: call.from, args: call.args ?? [], named: call.named ?? {} });
  };
  const onParameter = (call) => {
    const parts = call.name.split(/::|\./);
    return parts.length <= 2 && (nodes.get(call.from)?.params ?? []).some((param) => param.name === parts[0]);
  };
  const functionOf = (file, held, from, followed = /* @__PURE__ */ new Set()) => {
    if (!held) return null;
    if (held.fn) return nodes.has(held.fn) ? held.fn : null;
    if (held.local) {
      const key = JSON.stringify([file.path, from, held.local]);
      if (followed.has(key)) return null;
      const branch = new Set(followed).add(key);
      const bound = bindingFor(file, held.local, from);
      return bound ? functionOf(file, bound, from, branch) : resolve(file, held.local, from) ?? parameterValues(from, held.local).map((site) => functionOf(site.file, site.held, site.from, branch)).find(Boolean) ?? null;
    }
    return null;
  };
  const deferred = [];
  const parameterValues = (from, head, depth = 0) => {
    const params = nodes.get(from)?.params ?? [];
    const param = depth > 4 ? null : params.find((item) => item.name === head);
    const receiver = params[0] && RECEIVERS.has(params[0].name) && params[0].index === 0 ? 1 : 0;
    const values = [];
    const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : null;
    for (const site of param ? calledWith.get(from) ?? [] : []) {
      let held = site.args[param.index - receiver] ?? own(site.named, param.name);
      if (param.field !== void 0) held = own(held?.fields, param.field) ?? own(site.named, param.field);
      if (held) values.push({ held, file: site.file, from: site.from });
    }
    return values;
  };
  const parameterKinds = (from, head, depth = 0) => parameterValues(from, head, depth).map(({ held, file, from: at }) => ({ kind: classOf(file, held, at, depth), file })).filter((item) => item.kind);
  const classMethods = (file, name) => {
    let targets, declared2 = name;
    if (PACKAGED.has(file.language)) {
      targets = classFiles(file, name) ?? [];
      declared2 = declaredName(file, name);
    } else if (file.language === "swift") targets = swiftClassFiles(file, name) ?? [];
    else if (NATIVE.has(file.language)) targets = files.filter((item) => NATIVE.has(item.language)).map((item) => item.path);
    else {
      const imported = file.imports.find((item) => item.alias === name);
      targets = imported ? [resolveIn(file.path, imported.module, file.language, paths)].filter(Boolean) : [file.path];
      if (imported && imported.name !== "*") declared2 = imported.name;
    }
    return targets.flatMap((path) => byPath.get(path).file.methods.filter((method) => method.qualified_name.startsWith(`${declared2}.`)).map((method) => method.id));
  };
  const CONSTRUCTOR_NAMES = /* @__PURE__ */ new Set(["__init__", "constructor", "new", "init", "initialize", "__construct"]);
  const classOf = (file, value, from, depth = 0) => {
    if (!value || depth > 3) return null;
    if (value.type === "$self") {
      const owner2 = (nodes.get(from)?.qualified_name ?? "").split(".");
      return owner2.length > 1 ? { name: owner2.at(-2), full: owner2.slice(0, -1).join("."), path: nodes.get(from).path, from } : null;
    }
    if (value.type) return { name: value.type.split(/::|\./).at(-1), full: value.type.replaceAll("::", "."), from, path: file.path };
    if (value.local) {
      const held = bindingFor(file, value.local, from);
      if (held) return held !== value ? classOf(file, held, from, depth + 1) : null;
      return parameterKinds(from, value.local, depth + 1)[0]?.kind ?? classNamed(file, value.local, from, depth + 1) ?? decoratedKind(file, value.local, from, depth + 1);
    }
    if (!value.call) return null;
    const onKind = value.on ? classOf(file, value.on, from, depth) : null;
    const target = value.on ? onKind && memberOf2(file, onKind, value.call.split(".").at(-1)) : resolve(file, value.call, from, depth + 1);
    const parts = value.call.split(/::|\./);
    if (!target && parts.length === 1 && !value.on) {
      const bound = bindingFor(file, parts[0], from);
      if (bound && bound !== value) {
        const held = classOf(file, bound, from, depth + 1);
        if (held) return held;
      }
    }
    if (!target) return /^[A-Z]/.test(parts.at(-2) ?? "") ? { name: parts.at(-2), full: parts.slice(0, -1).join("."), path: file.path, from } : /^[A-Z]/.test(parts[0]) && parts.length === 1 ? { name: parts[0], path: file.path, from } : null;
    const node = nodes.get(target), owner = node.qualified_name.split(".");
    if (owner.length > 1 && (CONSTRUCTOR_NAMES.has(owner.at(-1)) || owner.at(-1) === owner.at(-2))) return { name: owner.at(-2), full: owner.slice(0, -1).join("."), path: node.path, from };
    const returned = node.returns && classOf(byPath.get(node.path).file, node.returns, target, depth + 1);
    if (returned && classMethods(byPath.get(node.path).file, returned.name).length) return returned;
    const built = node.yields && classOf(byPath.get(node.path).file, node.yields, target, depth + 1);
    if (built ?? returned) return built ?? returned;
    return owner.length > 1 && /^[A-Z]/.test(owner.at(-2)) ? { name: owner.at(-2), full: owner.slice(0, -1).join("."), path: node.path, from } : null;
  };
  const classNamed = (file, name, from, depth) => {
    if (depth > 6) return null;
    const target = resolve(file, name, from, depth + 1);
    const node = target && nodes.get(target), owner = node ? node.qualified_name.split(".") : [];
    if (owner.length > 1 && (CONSTRUCTOR_NAMES.has(owner.at(-1)) || owner.at(-1) === owner.at(-2))) return { name: owner.at(-2), full: owner.slice(0, -1).join("."), path: node.path, from };
    return !target && /^[A-Z]/.test(name) && !name.includes(".") && classMethods(file, name).length ? { name, path: file.path, from } : null;
  };
  const madeBy = (id, depth) => {
    const node = nodes.get(id);
    if (!node || depth > 4) return null;
    const held = node.yields ?? node.returns;
    if (!held) return null;
    if (held.fn) return nodes.has(held.fn) ? madeBy(held.fn, depth) : null;
    const file = byPath.get(node.path).file;
    if (held.local && !bindingFor(file, held.local, id)) {
      const inner = resolve(file, held.local, id, depth + 1);
      const made = inner && inner !== id && nodes.has(inner) ? madeBy(inner, depth) : null;
      if (made) return made;
    }
    return classOf(file, held, id, depth);
  };
  const decoratedKind = (file, name, from, depth) => {
    if (depth > 6) return null;
    const id = resolve(file, name, from, depth + 1);
    const node = id && nodes.get(id);
    for (const decorator of node?.decorators ?? []) {
      const target = resolve(byPath.get(node.path).file, decorator, id, depth + 1);
      const made = target && madeBy(target, depth);
      if (made) return made;
    }
    return null;
  };
  const classFile = (file, kind) => {
    if (kind.path && basesOf2(byPath.get(kind.path)?.file, kind.name)) return byPath.get(kind.path).file;
    if (basesOf2(file, kind.name)) return file;
    const imported = (file.imports ?? []).find((item) => item.alias === kind.name && !item.reexport);
    const target = imported && resolveIn(file.path, imported.module, file.language, paths);
    if (target && basesOf2(byPath.get(target)?.file, imported.name === "default" ? byPath.get(target).file.default_export : imported.name)) return byPath.get(target).file;
    const visible = PACKAGED.has(file.language) ? classFiles(file, kind.name) : file.language === "swift" ? swiftClassFiles(file, kind.name) : null;
    const declaring = (visible ?? []).map((path) => byPath.get(path)?.file).filter((item) => basesOf2(item, declaredName(file, kind.name)));
    return declaring.length === 1 ? declaring[0] : null;
  };
  const inherited = (file, kind, member, depth) => {
    const at = classFile(file, kind);
    for (const base of basesOf2(at, kind.name) ?? []) {
      const found = memberOf2(at, { name: base.split(/::|\./).at(-1), full: base.replaceAll("::", "."), path: at.path }, member, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const memberOf2 = (file, kind, member, depth = 0) => {
    if (depth > 4) return null;
    const home = kind.path && byPath.get(kind.path)?.file || file;
    for (const at of home === file ? [file] : [home, file]) {
      const found = memberFrom(at, kind, member);
      if (found) return found;
    }
    return inherited(home, kind, member, depth);
  };
  const memberFrom = (file, kind, member) => {
    const qualified = `${kind.name}.${member}`, full = kind.full && kind.full !== kind.name ? `${kind.full}.${member}` : null;
    const found = exact(file.path, qualified) ?? (full && exact(file.path, full));
    if (found) return found;
    const writer = nodes.get(kind.from);
    if (writer?.path === file.path) {
      const scopes = writer.qualified_name.split(".").slice(0, -1);
      for (let depth = scopes.length; depth > 0; depth -= 1) {
        const nested = exact(file.path, [...scopes.slice(0, depth), full ?? qualified].join("."));
        if (nested) return nested;
      }
    }
    const imported = (file.imports ?? []).find((item) => item.alias === kind.name && !item.reexport);
    const target = imported && resolveIn(file.path, imported.module, file.language, paths);
    if (target) {
      const name = imported.name === "default" ? byPath.get(target)?.file.default_export : imported.name === "*" ? kind.name : imported.name;
      const through = name && exported(target, `${name}.${member}`, file.language);
      if (through) return through;
    }
    if (full) {
      const through = viaImport(file, [...kind.full.split("."), member]);
      if (through) return through;
    }
    const globbed = throughGlobs(file, qualified) ?? (full ? throughGlobs(file, full) : null);
    if (globbed) return globbed;
    if (file.language === "go") {
      const own = samePackage(file, qualified) ?? (full ? samePackage(file, full) : null);
      if (own) return own;
    }
    if (file.language === "rust" && full) {
      const module = resolveIn(file.path, kind.full.split(".").slice(0, -1).join("::"), "rust", paths);
      const through = module && exact(module, qualified);
      if (through) return through;
    }
    if (PACKAGED.has(file.language)) {
      const outer = full ? kind.full.split(".")[0] : kind.name;
      const files2 = classFiles(file, outer);
      const member$ = files2 && single(files2, [declaredName(file, outer), ...(full ?? qualified).split(".").slice(1)].join("."));
      if (member$) return member$;
    }
    if (file.language === "kotlin") {
      const extension = jvmExtension(file, member, kind.name);
      if (extension) return extension;
    }
    if (file.language === "swift") {
      const files2 = swiftClassFiles(file, full ? kind.full.split(".")[0] : kind.name);
      const member$ = files2 && single(files2, full ?? qualified);
      if (member$) return member$;
    }
    if (NATIVE.has(file.language)) return linked(kind.from ?? null, [...(kind.full ?? kind.name).split("."), member], file, false);
    return null;
  };
  const memberOfReturned = (file, held, member, from, depth) => {
    const target = held?.call ? resolve(file, held.call, from, depth + 1) : null;
    const node = target && nodes.get(target);
    if (!node) return null;
    const fields = tableFields(byPath.get(node.path).file, node.returns ?? node.yields, target);
    return fields?.[member] ? functionOf(byPath.get(node.path).file, fields[member], target) : null;
  };
  const tableFields = (file, held, from, depth = 0) => {
    for (let value = held, hop = 0; value && hop < 4; hop++) {
      if (value.fields) return value.fields;
      if (!value.local) return null;
      value = bindingFor(file, value.local, from) ?? parameterValues(from, value.local, depth)[0]?.held ?? null;
    }
    return null;
  };
  const viaBinding = (file, name, member, from, depth = 0) => {
    const binding = bindingFor(file, name, from);
    const returned = binding && memberOfReturned(file, binding, member, from, depth);
    if (returned) return returned;
    const elsewhere = binding ? null : bindingElsewhere(file, name, from);
    const kind = binding ? classOf(file, binding, from, depth) : elsewhere && classOf(elsewhere.file, elsewhere.held, elsewhere.from ?? from, depth);
    return kind ? memberOf2(file, kind, member) : null;
  };
  const callees = /* @__PURE__ */ new Map(), callers = /* @__PURE__ */ new Map(), sites = /* @__PURE__ */ new Map(), dynamic = /* @__PURE__ */ new Set(), external = /* @__PURE__ */ new Map();
  const link = (map, from, to) => {
    if (!map.has(from)) map.set(from, /* @__PURE__ */ new Set());
    map.get(from).add(to);
  };
  const linkDynamic = (from, to, line) => {
    if (to === from || callees.get(from)?.has(to)) return;
    link(callees, from, to);
    link(callers, to, from);
    dynamic.add(`${from}->${to}`);
    if (!sites.has(`${from}->${to}`)) sites.set(`${from}->${to}`, line);
  };
  const beside = (file, call, to) => {
    for (const extra of /* @__PURE__ */ new Set([...overloadsOf(to, call), ...overridesOf(to)])) {
      linkDynamic(call.from, extra, call.line);
      remember(file, call, extra);
    }
  };
  const handed = (file, call) => {
    if (nodes.get(call.from)?.test) return;
    for (const held of [...call.args ?? [], ...Object.values(call.named ?? {})]) {
      const kind = held && classOf(file, held, call.from, 1);
      const home = kind?.path && byPath.get(kind.path)?.file;
      for (const id of kind ? classMethods(home ?? file, kind.name) : []) if (nodes.has(id)) linkDynamic(call.from, id, call.line);
    }
  };
  const uniformAccess = (file) => UNIFORM_ACCESS.has(file.language) ? file.reads ?? [] : [];
  const place = (file, call) => {
    const tableName = call.name.endsWith("[]") ? call.name.slice(0, -2) : !call.name.includes(".") && !call.name.includes("::") ? call.name : null;
    const to = call.name.endsWith("[]") ? null : resolve(file, call.name, call.from, 0, call.via ?? null);
    if (!to && tableName) {
      const fields = tableFields(file, { local: tableName }, call.from);
      if (fields) {
        for (const held of Object.values(fields)) {
          const target = functionOf(file, held, call.from);
          if (!target || target === call.from) continue;
          link(callees, call.from, target);
          link(callers, target, call.from);
          dynamic.add(`${call.from}->${target}`);
          if (!sites.has(`${call.from}->${target}`)) sites.set(`${call.from}->${target}`, call.line);
        }
        return;
      }
      if (call.name.endsWith("[]")) return;
    }
    if (!to) {
      if (call.name.startsWith("$receiver.") || !file.calls.includes(call)) return;
      if (onParameter(call)) deferred.push({ file, call });
      else handed(file, call);
      if (!external.has(call.from)) external.set(call.from, /* @__PURE__ */ new Map());
      external.get(call.from).set(`${call.name}:${call.line}`, { name: call.name, line: call.line });
      return;
    }
    if (to === call.from) return;
    link(callees, call.from, to);
    link(callers, to, call.from);
    remember(file, call, to);
    const key = `${call.from}->${to}`;
    if (!sites.has(key)) sites.set(key, call.line);
    beside(file, call, to);
  };
  const focused = focus ? new Set(files.filter((file) => focus(file.path)).flatMap((file) => file.methods.map((method) => method.id))) : null;
  const placing = focused && new Set(focused);
  if (placing) {
    const named2 = new Set([...focused].flatMap((id) => nodes.get(id).qualified_name.split(/::|\./)));
    const tail = (name) => String(name).split(/::|\./).at(-1);
    for (let grew = true; grew; ) {
      grew = false;
      for (const file of files) for (const [name, bases] of Object.entries(file.bases ?? {})) {
        if (!named2.has(tail(name))) continue;
        for (const base of bases ?? []) if (!named2.has(tail(base))) {
          named2.add(tail(base));
          grew = true;
        }
      }
    }
    for (const file of files) for (const item of file.imports ?? []) if (item.alias && named2.has(tail(item.name))) named2.add(item.alias);
    const mentions = (text3) => String(text3).split(/[^\w$]+/).some((word) => named2.has(word));
    const about = (item) => mentions(item.name) || (item.args?.length || item.named) && mentions(JSON.stringify([item.args ?? [], item.named ?? {}]));
    for (const file of files) {
      const imports2 = (file.imports ?? []).some((item) => named2.has(tail(item.name)) || item.alias && named2.has(item.alias));
      for (const call of [...file.calls, ...uniformAccess(file)]) if (imports2 || about(call)) placing.add(call.from);
      for (const value of file.values ?? []) if (imports2 || about(value)) placing.add(value.from);
    }
  }
  for (const file of files) for (const call of [...file.calls, ...uniformAccess(file)]) if (!placing || placing.has(call.from)) place(file, call);
  if (placing) {
    const reached = new Set([...focused].flatMap((id) => [...callees.get(id) ?? []]).filter((id) => !placing.has(id)));
    for (const id of reached) placing.add(id);
    for (const file of files) for (const call of [...file.calls, ...uniformAccess(file)]) if (reached.has(call.from)) place(file, call);
  }
  for (let waiting = deferred.splice(0); waiting.length; ) {
    const again = [];
    for (const { file, call } of waiting) {
      const [head, member] = call.name.split(/::|\./);
      const found = member === void 0 ? parameterValues(call.from, head).map((site) => functionOf(site.file, site.held, site.from)) : parameterKinds(call.from, head).map(({ kind, file: at }) => memberOf2(at, kind, member));
      const targets = new Set(found.filter((to) => to && to !== call.from));
      if (!targets.size) {
        again.push({ file, call });
        continue;
      }
      external.get(call.from)?.delete(`${call.name}:${call.line}`);
      for (const to of targets) {
        link(callees, call.from, to);
        link(callers, to, call.from);
        remember(file, call, to);
        const key = `${call.from}->${to}`;
        if (!sites.has(key)) sites.set(key, call.line);
        beside(file, call, to);
      }
    }
    if (again.length === waiting.length) {
      for (const { file, call } of again) handed(file, call);
      break;
    }
    waiting = again;
  }
  for (const file of files) {
    for (const method of file.methods) {
      if (!method.parent || method.test || callees.get(method.parent)?.has(method.id)) continue;
      link(callees, method.parent, method.id);
      link(callers, method.id, method.parent);
      dynamic.add(`${method.parent}->${method.id}`);
      if (!sites.has(`${method.parent}->${method.id}`)) sites.set(`${method.parent}->${method.id}`, method.line);
    }
  }
  for (const file of files) {
    for (const value of file.values ?? []) {
      if (placing && !placing.has(value.from)) continue;
      const to = resolve(file, value.name, value.from);
      if (!to || to === value.from || !nodes.has(to)) continue;
      if (callees.get(value.from)?.has(to)) continue;
      link(callees, value.from, to);
      link(callers, to, value.from);
      dynamic.add(`${value.from}->${to}`);
      if (!sites.has(`${value.from}->${to}`)) sites.set(`${value.from}->${to}`, value.line);
    }
  }
  const readsBy = /* @__PURE__ */ new Map();
  for (const file of files) for (const read of file.reads ?? []) readsBy.set(read.from, [...readsBy.get(read.from) ?? [], { name: read.name, line: read.line }]);
  const methodsOf2 = (path) => byPath.get(path)?.file.methods.map((method) => method.id) ?? [];
  const pythonPath = (file, path) => {
    const found = pythonModule(file, path.split("."), 0);
    if (!found) return [];
    const { target, rest } = found;
    if (!rest.length) return methodsOf2(target);
    const members = rest.length === 1 ? byPath.get(target).file.methods.filter((method) => method.qualified_name.startsWith(`${rest[0]}.`)).map((method) => method.id) : [];
    return [...new Set([inModule(target, rest), ...members].filter(Boolean))];
  };
  const cutBy = (file, target, from) => {
    if (target.kind === "module") {
      const path = resolveIn(file.path, target.module, file.language, paths);
      return path ? methodsOf2(path) : [];
    }
    if (target.kind === "path") return pythonPath(file, target.path);
    if (target.kind === "member") return [resolve(file, `${target.object}.${target.name}`, from)].filter(Boolean);
    if (target.kind === "class") return classMethods(file, target.name);
    return [];
  };
  return {
    nodes,
    /** Whether an edge was inferred from a handover rather than seen as a call. */
    isDynamic: (from, to) => dynamic.has(`${from}->${to}`),
    files: byPath,
    callees: (id) => [...callees.get(id) ?? []],
    callers: (id) => [...callers.get(id) ?? []],
    /**
     * Return the first recorded source line for the directed edge from `from` to `to`.
     * The line may identify a call or a function-value handover. Return null when no
     * such edge was recorded; this lookup does not change the graph.
     */
    site: (from, to) => {
      const edge = `${from}->${to}`;
      return sites.get(edge) ?? null;
    },
    edgeCount: () => [...callees.values()].reduce((sum, set) => sum + set.size, 0),
    /** The members a method reads without calling them, `process.env.KEY` or `os.environ`, each with its line. */
    reads: (id) => readsBy.get(id) ?? [],
    /** The calls a method makes that resolve to nothing in the repository, each with its line. */
    external: (id) => [...external.get(id)?.values() ?? []],
    /**
     * Whether a method calls or reads a name its file imports from a file in this repository, whatever that name resolves to:
     * `typeof axios.all` checks the repository's own export without a call perch can follow.
     */
    usesRepository: (id) => {
      const node = nodes.get(id), file = node && byPath.get(node.path)?.file;
      if (!file) return false;
      const local = new Set((file.imports ?? []).filter((item) => resolveIn(file.path, item.module, file.language, paths)).map((item) => item.alias));
      return [...external.get(id)?.values() ?? [], ...readsBy.get(id) ?? []].some((use) => local.has(String(use.name).split(/::|\./)[0]));
    },
    /**
     * The methods a test's mocks replace: its own mocks and the file's. A target resolves by the rules a call does, so a mock
     * of something outside the repository cuts nothing.
     */
    mocks: (id) => {
      const node = nodes.get(id);
      const file = node && byPath.get(node.path)?.file;
      if (!file) return [];
      const cut = /* @__PURE__ */ new Set();
      for (const mock of file.mocks ?? []) {
        if (mock.owner !== id && mock.owner !== "file") continue;
        for (const target of cutBy(file, mock.target, id)) if (nodes.has(target)) cut.add(target);
      }
      return [...cut];
    }
  };
}

// analysis.mjs
import { default as default2 } from "@xberg-io/tree-sitter-language-pack";
export {
  Node,
  analyzeFiles,
  buildGraph,
  createFileSelector,
  createSourceAnalyzer,
  downloading,
  listTree,
  normalizeLanguage,
  readBlob,
  sourceFile,
  default2 as treeSitterPack
};
