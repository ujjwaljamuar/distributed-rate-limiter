-- KEYS[1] = token key
-- KEYS[2] = timestamp key

-- ARGV[1] = max_tokens
-- ARGV[2] = refill_rate (tokens per second)
-- ARGV[3] = current_time (seconds)

local tokens_key = KEYS[1]
local timestamp_key = KEYS[2]

local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- get current state
local tokens = tonumber(redis.call("GET", tokens_key))
local last_time = tonumber(redis.call("GET", timestamp_key))

if tokens == nil then
  tokens = max_tokens
end

if last_time == nil then
  last_time = now
end

-- refill tokens
local delta = math.max(0, now - last_time)
local refill = delta * refill_rate
tokens = math.min(max_tokens, tokens + refill)

-- check if request allowed
if tokens >= 1 then
  tokens = tokens - 1

  redis.call("SET", tokens_key, tokens)
  redis.call("SET", timestamp_key, now)

  return 1
else
  redis.call("SET", tokens_key, tokens)
  redis.call("SET", timestamp_key, now)

  return 0
end