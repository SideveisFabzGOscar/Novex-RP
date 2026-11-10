local function getDiscordId(src)
  for _, id in ipairs(GetPlayerIdentifiers(src)) do
    if string.sub(id, 1, 8) == 'discord:' then
      return string.sub(id, 9)
    end
  end
  return nil
end

AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
  local src = source
  deferrals.defer()
  Wait(0)
  deferrals.update('Sjekker whitelist hos Novex …')

  local discordId = getDiscordId(src)
  if not discordId then
    deferrals.done('Du må ha Discord åpent og koblet til FiveM for å spille på Novex. Start Discord og prøv igjen.')
    return
  end

  local url = ('%s/api/fivem/whitelist/%s'):format(Config.ApiUrl, discordId)
  PerformHttpRequest(url, function(status, body)
    if status ~= 200 or not body then
      print(('[novex-whitelist] API svarte %s for %s'):format(tostring(status), name))
      if Config.AllowWhenApiDown then
        deferrals.done()
      else
        deferrals.done('Whitelist-sjekken er nede akkurat nå. Prøv igjen om litt.')
      end
      return
    end

    local ok, data = pcall(json.decode, body)
    if ok and data and data.whitelisted then
      deferrals.done()
    elseif ok and data and data.registered then
      deferrals.done(('Du er ikke whitelistet ennå. Sjekk søknaden din på %s'):format(Config.Website))
    else
      deferrals.done(('Du er ikke whitelistet. Logg inn med Discord og søk på %s'):format(Config.Website))
    end
  end, 'GET', '', { ['x-api-key'] = Config.ApiKey })
end)

--[[ Bedrifter kjøpt i butikken på nettsiden
     Ressursen henter hvem som eier hvilken bedrift, og gir det videre til
     bedriftsscriptet ditt. Bruk enten eventet eller exports:

       AddEventHandler('novex:bedrifter', function(bedrifter)
         -- bedrifter['kafe-torget'] = { id = 'kafe-torget', type = 'kafe', name = 'Kafé Torget', owner = '1229825750429991067' }
       end)

       exports['novex-whitelist']:GetBusinessOwner('kafe-torget')        -- Discord-ID eller nil
       exports['novex-whitelist']:GetOwnedBusinesses(source)             -- liste over bedriftene spilleren eier
       exports['novex-whitelist']:IsBusinessOwner(source, 'kafe-torget') -- true/false

     ID-ene (kafe-torget osv.) står i public/shop.js på nettsiden. ]]
local businesses = {}

local function syncBusinesses()
  PerformHttpRequest(Config.ApiUrl .. '/api/fivem/businesses', function(status, body)
    if status ~= 200 or not body then
      print(('[novex-whitelist] Kunne ikke hente bedrifter (%s)'):format(tostring(status)))
      return
    end
    local ok, data = pcall(json.decode, body)
    if not ok or not data or not data.businesses then return end
    local fresh = {}
    for _, b in ipairs(data.businesses) do fresh[b.id] = b end
    businesses = fresh
    TriggerEvent('novex:bedrifter', businesses)
  end, 'GET', '', { ['x-api-key'] = Config.ApiKey })
end

CreateThread(function()
  while true do
    syncBusinesses()
    Wait((Config.BusinessSyncMinutes or 2) * 60 * 1000)
  end
end)

RegisterCommand('novex_bedrifter', function(src)
  if src ~= 0 then return end -- bare fra serverkonsollen
  syncBusinesses()
  print('[novex-whitelist] Henter bedrifter på nytt')
end, true)

exports('GetBusinessOwner', function(id)
  local b = businesses[id]
  return b and b.owner or nil
end)

exports('GetOwnedBusinesses', function(src)
  local discordId = getDiscordId(src)
  local out = {}
  if not discordId then return out end
  for _, b in pairs(businesses) do
    if b.owner == discordId then out[#out + 1] = b end
  end
  return out
end)

exports('IsBusinessOwner', function(src, id)
  local b = businesses[id]
  return b ~= nil and b.owner == getDiscordId(src)
end)
