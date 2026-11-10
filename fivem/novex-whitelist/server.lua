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
