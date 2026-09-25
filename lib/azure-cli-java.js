/* Local CLI bridge. All stdout stays in memory; stderr is drained and discarded. */
var AzureCliJava = (function () {
    "use strict";
    var Files = Java.type("java.nio.file.Files"), Paths = Java.type("java.nio.file.Paths");
    var System = Java.type("java.lang.System"), Thread = Java.type("java.lang.Thread");
    var ProcessBuilder = Java.type("java.lang.ProcessBuilder");
    var Bytes = Java.type("java.io.ByteArrayOutputStream");
    var UTF8 = Java.type("java.nio.charset.StandardCharsets").UTF_8;
    var windows = String(System.getProperty("os.name")).toLowerCase().indexOf("win") === 0;
    function env(name) { var value = System.getenv(name); return value === null ? "" : String(value); }
    function executable(file) {
        try {
            var p = Paths.get(file);
            return p.isAbsolute() && Files.isRegularFile(p) && (windows || Files.isExecutable(p));
        } catch (ignored) { return false; }
    }
    function locate() {
        var override = env("ARCHI_AZURE_CLI");
        if (override) {
            AzureCore.assert(executable(override), "ARCHI_AZURE_CLI must name an existing absolute Azure CLI executable.");
            return override;
        }
        var dirs = env("PATH").split(windows ? ";" : ":");
        if (windows) {
            [env("ProgramFiles"), env("ProgramFiles(x86)")].filter(Boolean).forEach(function (base) {
                dirs.push(base + "\\Microsoft SDKs\\Azure\\CLI2\\wbin");
            });
        } else dirs = dirs.concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]);
        var names = windows ? ["az.cmd", "az.exe", "az.bat"] : ["az"];
        for (var i = 0; i < dirs.length; i++) {
            var dir = dirs[i].replace(/^"|"$/g, "");
            // Do not execute a lookalike from the current directory or relative PATH entries.
            if (!dir || !Paths.get(dir).isAbsolute()) continue;
            for (var j = 0; j < names.length; j++) {
                var candidate = String(Paths.get(dir).resolve(names[j]).normalize());
                if (executable(candidate)) return candidate;
            }
        }
        throw new Error("Azure CLI was not found. Install Azure CLI 2.54+ and restart Archi, or set ARCHI_AZURE_CLI to its absolute executable path. Device sign-in remains available without Azure CLI.");
    }
    function stop(process) {
        if (!process) return;
        try {
            var children = process.descendants();
            try { children.forEach(function (p) { p.destroyForcibly(); }); } finally { children.close(); }
            if (process.isAlive()) process.destroyForcibly();
        } catch (ignored) {}
    }
    function run(executablePath, args, timeoutMs) {
        var processor = windows ? env("SystemRoot") + "\\System32\\cmd.exe" : "";
        var command = AzureCli.command(executablePath, args, windows, processor);
        var process = null, stdout = null, stderr = null;
        var buffer = new Bytes(), seen = 0, limit = 1024 * 1024;
        function drain(stream, retain) {
            while (stream.available() > 0) {
                var chunk = stream.readNBytes(Math.min(Number(stream.available()), 8192));
                if (!chunk.length) break;
                seen += chunk.length;
                if (seen > limit) throw new Error("Azure CLI output exceeded the allowed size.");
                if (retain) buffer.write(chunk);
            }
        }
        try {
            var builder = new ProcessBuilder(Java.to(command, "java.lang.String[]"));
            // Deterministic encoding, no ANSI formatting and no Azure CLI telemetry for these subprocesses.
            builder.environment().put("PYTHONIOENCODING", "utf-8");
            builder.environment().put("AZURE_CORE_NO_COLOR", "true");
            builder.environment().put("AZURE_CORE_COLLECT_TELEMETRY", "false");
            process = builder.start();
            process.getOutputStream().close(); // No password or interactive prompt is accepted through stdin.
            stdout = process.getInputStream(); stderr = process.getErrorStream();
            var start = Number(System.nanoTime());
            while (true) {
                drain(stdout, true); drain(stderr, false);
                if (!process.isAlive()) {
                    drain(stdout, true); drain(stderr, false);
                    return {exitCode: Number(process.exitValue()), stdout: String(buffer.toString(UTF8))};
                }
                if ((Number(System.nanoTime()) - start) / 1000000 > timeoutMs)
                    throw new Error("Azure CLI timed out.");
                Thread.sleep(20);
            }
        } catch (ignored) {
            // Do not expose the subprocess command's output, tokens or raw Java errors.
            throw new Error("Azure CLI execution failed, timed out, or exceeded its output limit.");
        } finally {
            stop(process);
            if (stdout) try { stdout.close(); } catch (ignored) {}
            if (stderr) try { stderr.close(); } catch (ignored) {}
            buffer.reset();
        }
    }
    function createIo(executablePath) {
        var file = executablePath || locate();
        return {run: function (args) { return run(file, args, 90000); }, now: function () { return Date.now(); }};
    }
    return {createIo: createIo, locate: locate, run: run};
}());
