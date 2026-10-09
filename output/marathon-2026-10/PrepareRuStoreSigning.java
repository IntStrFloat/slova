import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.jar.*;

// All passwords stay inside this JVM; process arguments and diagnostics contain none.
class PrepareRuStoreSigning {
  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[0]).toRealPath();
    Path jar = Path.of(args[1]).toRealPath();
    Properties config = new Properties();
    try (InputStream in = Files.newInputStream(root.resolve("credentials/keystore.properties"))) { config.load(in); }
    Path key = root.resolve("credentials/release.jks").toRealPath();
    if (!root.resolve("android/app").resolve(config.getProperty("storeFile")).toRealPath().equals(key)) {
      throw new IllegalStateException("Unexpected signing keystore");
    }
    byte[] before = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(key));
    Path output = root.resolve("credentials/rustore-marathon-upload");
    Files.createDirectories(output);
    Path zip = output.resolve("rustore-signing-encrypted.zip");
    if (Files.exists(zip)) throw new IllegalStateException("Signing export already exists; refusing to overwrite");
    String main;
    try (JarFile jf = new JarFile(jar.toFile())) { main = jf.getManifest().getMainAttributes().getValue("Main-Class"); }
    PrintStream stdout = System.out, stderr = System.err;
    try (URLClassLoader loader = new URLClassLoader(new URL[]{jar.toUri().toURL()})) {
      ByteArrayOutputStream quiet = new ByteArrayOutputStream();
      System.setOut(new PrintStream(quiet)); System.setErr(new PrintStream(quiet));
      String[] flags = {
        "--keystore=" + key, "--alias=" + config.getProperty("keyAlias"), "--output=" + zip,
        "--keystore-pass=" + config.getProperty("storePassword"), "--key-pass=" + config.getProperty("keyPassword"),
        "--encryptionkey=0000a0dc8c97b93ed7d37312d452c49fbb93171529579e8d899f8cd428a12a21820abfee09ffb8a56270962a306bd8ba85b293bb7d2d6a5c1cc0ddba569aec28d4ee9a0b",
        "--include-cert"
      };
      try { Class.forName(main, true, loader).getMethod("main", String[].class).invoke(null, (Object) flags); }
      catch (ReflectiveOperationException ex) { throw new IllegalStateException("Official PEPK export failed; sensitive diagnostics suppressed"); }
      finally { Arrays.fill(flags, ""); System.setOut(stdout); System.setErr(stderr); }
    }
    KeyStore store = KeyStore.getInstance(key.toFile(), config.getProperty("storePassword").toCharArray());
    byte[] cert = store.getCertificate(config.getProperty("keyAlias")).getEncoded();
    String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert));
    if (!fingerprint.equals("8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd")) throw new IllegalStateException("Unexpected certificate");
    String pem = "-----BEGIN CERTIFICATE-----\n" + Base64.getMimeEncoder(64, new byte[]{10}).encodeToString(cert) + "\n-----END CERTIFICATE-----\n";
    Files.writeString(output.resolve("upload-certificate.pem"), pem, StandardCharsets.US_ASCII);
    if (!MessageDigest.isEqual(before, MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(key)))) throw new IllegalStateException("Keystore changed");
    if (!Files.isRegularFile(zip) || Files.size(zip) == 0 || Files.size(zip) > 100_000) throw new IllegalStateException("Unexpected export size");
    config.clear();
    stdout.println("Encrypted PEPK ZIP and public PEM prepared locally; original keystore unchanged; certificate verified. No upload performed.");
    stdout.println("ZIP bytes: " + Files.size(zip));
  }
}
