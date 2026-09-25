/* Java standard library only. Runs inside jArchi/GraalJS on all Archi desktop platforms. */
var AzureJava = (function () {
    "use strict";
    var Files = Java.type("java.nio.file.Files"), Paths = Java.type("java.nio.file.Paths");
    var UTF8 = Java.type("java.nio.charset.StandardCharsets").UTF_8;
    var URI = Java.type("java.net.URI"), JString = Java.type("java.lang.String");
    function path(p) { return Paths.get(String(p)); }
    function request(method, url, headers, body) {
        var connection = null, stream = null;
        try {
            connection = URI.create(String(url)).toURL().openConnection();
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(90000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(method);
            Object.keys(headers || {}).forEach(function (key) { connection.setRequestProperty(key, String(headers[key])); });
            if (method === "POST") {
                var bytes = new JString(String(body)).getBytes(UTF8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                var output = connection.getOutputStream();
                try { output.write(bytes); } finally { output.close(); }
            }
            var status = Number(connection.getResponseCode());
            stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            var data;
            try { data = stream ? JSON.parse(String(new JString(stream.readAllBytes(), UTF8))) : {}; }
            catch (ignored) { data = {}; }
            var h = {};
            ["retry-after", "x-ms-retry-after-ms"].forEach(function (name) {
                var value = connection.getHeaderField(name);
                if (value !== null) h[name] = String(value);
            });
            return {status: status, body: data, headers: h};
        } catch (ignored) {
            throw new Error("HTTPS request failed (network, timeout, proxy or TLS). No model changes have been applied.");
        } finally {
            if (stream) try { stream.close(); } catch (ignored) {}
            if (connection) connection.disconnect();
        }
    }
    function read(file) { return String(Files.readString(path(file), UTF8)); }
    function write(file, text) { Files.writeString(path(file), String(text), UTF8); }
    function resolve(root, child) { return String(path(root).resolve(String(child)).normalize().toAbsolutePath()); }
    function icon(root, relative) {
        var base = path(resolve(root, "assets/icons")).toRealPath();
        var p = base.resolve(relative).normalize();
        if (!p.startsWith(base) || !Files.isRegularFile(p) || !p.toRealPath().startsWith(base))
            throw new Error("Missing or unsafe icon: " + relative);
        return String(p.toRealPath());
    }
    return {io: {request: request, sleep: function (ms) { Java.type("java.lang.Thread").sleep(Math.ceil(ms)); },
        now: function () { return Date.now(); }}, read: read, write: write, resolve: resolve, icon: icon};
}());
