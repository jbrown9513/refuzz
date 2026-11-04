-- Runs one luzer fuzz target in-process for many inputs, the way libFuzzer runs it: the target file defines
-- `TestOneInput(buf)` and ends with `luzer.Fuzz(TestOneInput, nil, args)`. It is loaded here with a stand-in luzer whose
-- `Fuzz` keeps TestOneInput instead of starting libFuzzer (FuzzedDataProvider is luzer's own), so the same file runs unchanged
-- under luzer. Each input arrives on stdin as a u32 LE length and its raw bytes and is handed to TestOneInput as a string. For
-- each input it writes one JSON line: what happened, whose code failed (the project's, an `assert` or `error` the target makes
-- to state a property, or a bug in the target's own lines), the project's frames, and the coverage edges and lines this
-- process had not seen before. Usage: lua lua_fuzz.lua <target.lua> <root> <package.path> <timeout ms>
local target_path, root, path, timeout_ms = ...
package.path = path .. ";" .. package.path
local ROOT = root .. "/"
local TARGET = "@(target)"
local TIMEOUT = tonumber(timeout_ms) / 1000
local out = io.stdout
-- What the target and the project print must not land in the report stream.
print = function(...) io.stderr:write(table.concat(table.pack(...), "\t"), "\n") end
io.write = function(...) return io.stderr:write(...) end
local EXIT, TIMEDOUT, ARRAY = {}, {}, {}
os.exit = function(code) error({ [EXIT] = code }, 2) end

-- The project's Lua files, relative to the root, for mapping installed copies back to them: listed the first time one is needed.
local listed
local function sources()
  if not listed then
    listed = {}
    local p = io.popen("cd '" .. root:gsub("'", "'\\''") .. "' && find . -name '*.lua' -not -path '*/.*' -not -path '*/node_modules/*' 2>/dev/null")
    if p then
      for l in p:lines() do listed[#listed + 1] = l:sub(3) end
      p:close()
    end
  end
  return listed
end

-- The project file a chunk source (`@/path`) is, relative to the project's folder, or false. The project's build installs its
-- modules the way its users get them (`luarocks make` copies them into the tree's share/lua/<version>/), so a file there is
-- mapped back to the checkout's file with the same path below the module root.
local mapped = {}
local function source_of(source)
  local known = mapped[source]
  if known ~= nil then return known end
  local rel = false
  if source:sub(1, #ROOT + 1) == "@" .. ROOT then
    rel = source:sub(#ROOT + 2)
  else
    local tail = source:match("^@.-/share/lua/[%d.]+/(.+)$")
    if tail then
      local found, n = nil, 0
      for _, f in ipairs(sources()) do
        if f == tail or f:sub(-#tail - 1) == "/" .. tail then found, n = f, n + 1 end
      end
      if n == 1 then rel = found end
    end
  end
  if rel and (("/" .. rel):find("/spec/", 1, true) or ("/" .. rel):find("/tests?/")) then rel = false end
  mapped[source] = rel
  return rel
end

local function project(source)
  return source_of(source) ~= false
end

-- Coverage: edges between consecutive project lines, hashed, from a line hook on while the target runs. File ids are a
-- hash of the path, so a restarted process gives the same features.
local ids, paths = {}, {}
local seen = {}
local current, lines_now, prev = {}, {}, 0
local deadline = math.huge

local function file_id(source)
  local id = ids[source]
  if id == nil then
    id = -1
    if project(source) then
      local h = 2166136261
      for i = 1, #source do h = ((h ~ source:byte(i)) * 16777619) & 0xFFFFFFFF end
      id = h & 0xFFFF
      paths[id] = source_of(source)
    end
    ids[source] = id
  end
  return id
end

local ticks = 0
local function hook(event, line)
  -- The time limit, checked every so many events: Lua 5.4.4 does not deliver count events while a line hook is set, so
  -- line events count too (every loop in Lua code jumps back and fires one).
  ticks = ticks + 1
  if (event == "count" or ticks & 4095 == 0) and os.clock() > deadline then deadline = math.huge; error(TIMEDOUT, 0) end
  if event == "count" then return end
  local id = file_id(debug.getinfo(2, "S").source)
  if id < 0 then return end
  local here = (id << 20) | (line & 0xFFFFF)
  current[(prev * 31 + here) & 0xFFFFFFFF] = true
  lines_now[here] = true
  prev = here
end

local function on() debug.sethook(hook, "l", 10000) end

-- A hook is per coroutine: the project's coroutines get it too.
local cocreate = coroutine.create
coroutine.create = function(f)
  local co = cocreate(f)
  debug.sethook(co, hook, "l", 10000)
  return co
end
coroutine.wrap = function(f)
  local co = coroutine.create(f)
  return function(...)
    local r = table.pack(coroutine.resume(co, ...))
    if not r[1] then error(r[2], 0) end
    return table.unpack(r, 2, r.n)
  end
end

local function quote(s)
  return '"' .. s:gsub('[%c"\\\128-\255]', function(c)
    local named = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
    return named[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function json(v)
  local t = type(v)
  if t == "table" then
    local out = {}
    if #v > 0 or getmetatable(v) == ARRAY then
      for _, x in ipairs(v) do out[#out + 1] = json(x) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    for k, x in pairs(v) do out[#out + 1] = quote(tostring(k)) .. ":" .. json(x) end
    return "{" .. table.concat(out, ",") .. "}"
  elseif t == "string" then return quote(v)
  elseif t == "number" or t == "boolean" then return tostring(v)
  end
  return "null"
end

-- A value printed the same way every run: keys sorted, no addresses, cycles and depth cut off.
local function show(v, depth, seen_)
  local t = type(v)
  if t == "string" then return string.format("%q", v) end
  if t == "number" then return math.type(v) == "integer" and tostring(v) or string.format("%.17g", v) end
  if t == "boolean" or t == "nil" then return tostring(v) end
  if t ~= "table" then return "<" .. t .. ">" end
  local mt = getmetatable(v)
  if type(mt) == "table" and mt.__tostring then
    local ok, s = pcall(tostring, v)
    if ok then return s end
  end
  if seen_[v] then return "<cycle>" end
  if depth > 3 then return "{...}" end
  seen_[v] = true
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b)
    if type(a) == type(b) and (type(a) == "number" or type(a) == "string") then return a < b end
    return type(a) < type(b)
  end)
  local parts, n = {}, #v
  for i, k in ipairs(keys) do
    if i > 30 then parts[#parts + 1] = "..." break end
    if math.type(k) == "integer" and k >= 1 and k <= n then parts[#parts + 1] = show(v[k], depth + 1, seen_)
    else parts[#parts + 1] = (type(k) == "string" and k:match("^[%a_][%w_]*$") and k or "[" .. show(k, depth + 1, seen_) .. "]") .. " = " .. show(v[k], depth + 1, seen_) end
  end
  seen_[v] = nil
  return "{" .. table.concat(parts, ", ") .. "}"
end

local function handler(msg)
  if msg == TIMEDOUT then return { timeout = true } end
  local info = debug.getinfo(2, "Sn")
  local kind = "runtime"
  local raised = info and info.what == "C" and (info.name == "error" or info.name == "assert")
  if type(msg) == "table" and msg[EXIT] ~= nil then kind = "Exit"
  elseif raised then kind = "error" end
  -- `assert` or `error` called from a line of the target: a property it states, unless it passes on a project's error.
  local caller = raised and debug.getinfo(3, "S")
  local frames = {}
  for level = 2, 200 do
    local f = debug.getinfo(level, "Sln")
    if not f then break end
    if f.what ~= "C" then frames[#frames + 1] = { source = f.source, line = f.currentline, name = f.name or ("function <" .. f.short_src:gsub("^" .. ROOT:gsub("%p", "%%%0"), "") .. ":" .. f.linedefined .. ">") } end
  end
  return { msg = msg, kind = kind, frames = frames, asserted = caller and caller.source == TARGET }
end

-- luzer as a target sees it: `Fuzz` hands over TestOneInput; the data provider is luzer's own.
local impl = require("luzer_impl")
local target
package.loaded.luzer = {
  Fuzz = function(test_one_input) target = test_one_input end,
  FuzzedDataProvider = impl.FuzzedDataProvider,
  path = impl.path,
  _internal = {},
}

do
  local f = io.open(target_path)
  local code = f and f:read("a")
  if f then f:close() end
  local chunk, err = load(code or "", TARGET, "t")
  local ok = chunk ~= nil
  if ok then ok, err = pcall(chunk) end
  if ok and type(target) ~= "function" then ok, err = false, "the target never calls luzer.Fuzz(TestOneInput)" end
  if not ok then
    out:write(json({ fatal = tostring(type(err) == "table" and show(err, 0, {}) or err):gsub("%(target%):", "target line ") }), "\n")
    out:flush()
    return
  end
end
out:write('{"ready":true}\n')
out:flush()

while true do
  local head = io.stdin:read(4)
  if not head or #head < 4 then break end
  local n = string.unpack("<I4", head)
  local buf = n > 0 and io.stdin:read(n) or ""
  math.randomseed(0)
  current, lines_now, prev = {}, {}, 0
  deadline = os.clock() + TIMEOUT
  on()
  local ok, r = xpcall(target, handler, buf)
  debug.sethook()
  deadline = math.huge
  local report
  if ok then
    report = { status = "ok", result = show(r, 0, {}):sub(1, 300) }
  elseif r.timeout then
    report = { status = "timeout", origin = "library", type = "Timeout" }
  else
    -- Whose code failed: the target's own assert or error, else the innermost frame that is the target's or the project's.
    local origin, at = "setup", nil
    for _, f in ipairs(r.frames) do
      if f.source == TARGET then at = f.line break end
      if project(f.source) then origin = "library" break end
    end
    local msg = r.msg
    if type(msg) == "table" and msg[EXIT] ~= nil then msg = "os.exit(" .. tostring(msg[EXIT]) .. ") called"
    elseif type(msg) == "table" then msg = show(msg, 0, {})
    elseif type(msg) ~= "string" then msg = tostring(msg) end
    local frames = setmetatable({}, ARRAY)
    for i = #r.frames, 1, -1 do
      local f = r.frames[i]
      if project(f.source) then frames[#frames + 1] = { path = source_of(f.source), line = f.line, name = f.name } end
    end
    -- An error the target passes on with error(err, 0) carries the project's position: it is the project's.
    local ppath, pline = msg:match("^(/[^:]+%.lua):(%d+): ")
    local passed = ppath and source_of("@" .. ppath) or nil
    if r.asserted and passed then
      origin = "library"
      frames[#frames + 1] = { path = passed, line = tonumber(pline), name = "" }
    elseif r.asserted then origin = "assertion" end
    msg = msg:gsub(ROOT:gsub("%p", "%%%0"), "")
    if origin == "assertion" then msg = msg:gsub("^%(target%):%d+: ", "")
    elseif at and origin == "setup" then msg = "target line " .. at .. ": " .. msg:gsub("^%(target%):%d+: ", "") end
    while #frames > 12 do table.remove(frames, 1) end
    report = { status = "error", origin = origin, type = origin == "assertion" and "assertion" or r.kind, message = msg:sub(1, 400), frames = frames }
  end
  local features = setmetatable({}, ARRAY)
  for k in pairs(current) do
    if not seen[k] then seen[k] = true features[#features + 1] = k end
  end
  report.features = features
  local lines = setmetatable({}, ARRAY)
  for h in pairs(lines_now) do
    local p = paths[h >> 20]
    if p then lines[#lines + 1] = setmetatable({ p, h & 0xFFFFF }, ARRAY) end
  end
  report.lines = lines
  out:write(json(report), "\n")
  out:flush()
end
