// OURS - not part of ATM10 To the Sky. Installed by fetch-modpack.sh from
// overlay/, hashed by check-drift.sh.
//
// Stop the day/night cycle and the weather while nobody is online, so the
// world a player logs back into is the world they left: same time of day, same
// sky. Asked for by the operator on 2026-10-25.
//
// Gamerules only, by decision. The server keeps ticking, so machines in
// force-loaded chunks keep running; only the clock and the weather wait. A
// full JVM pause (itzg autopause) was the other option, and was declined: the
// Status Poller's 15-second ping would wake it constantly, and the first
// player in would wait for it to resume.
//
// Done in-game rather than from the poller or the bot so that it keeps
// working when either of them is down — it depends on nothing but the server.

function setClock(server, running) {
  server.runCommandSilent(`gamerule doDaylightCycle ${running}`)
  server.runCommandSilent(`gamerule doWeatherCycle ${running}`)
}

// The server always starts empty. Without this a restart would leave the
// clock running until the first player came and went.
ServerEvents.loaded(event => {
  setClock(event.server, false)
})

PlayerEvents.loggedIn(event => {
  setClock(event.server, true)
})

// Checked a second after the logout rather than inside it, so it does not
// matter whether the leaving player is still counted when this event fires,
// and so two players leaving together are both gone before anyone counts.
PlayerEvents.loggedOut(event => {
  const server = event.server
  server.scheduleInTicks(20, () => {
    if (server.getPlayerCount() === 0) setClock(server, false)
  })
})
