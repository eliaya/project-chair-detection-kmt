-- Address of the Pi on the store LAN (e.g. http://192.168.1.20:8080), entered by hand: the admin
-- UI embeds the Pi's /live stream from it, so it works only from a browser on that LAN.
ALTER TABLE devices ADD COLUMN lan_url TEXT NOT NULL DEFAULT '';
