import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Reads public certificates only; never asks for or accesses private-key passwords. */
public class InspectPublicKeystoreCertificate {
  public static void main(String[] args) throws Exception {
    KeyStore keystore = KeyStore.getInstance("JKS");
    try (InputStream input = Files.newInputStream(Path.of(args[0]))) { keystore.load(input, null); }
    List<String> digests = new ArrayList<>();
    Enumeration<String> aliases = keystore.aliases();
    while (aliases.hasMoreElements()) {
      java.security.cert.Certificate certificate = keystore.getCertificate(aliases.nextElement());
      if (certificate != null) digests.add(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
    }
    if (digests.isEmpty()) throw new IllegalStateException("No public certificates could be read without a password");
    System.out.println("[\"" + String.join("\",\"", digests) + "\"]");
  }
}
