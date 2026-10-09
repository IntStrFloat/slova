import com.android.aapt.Resources;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import java.util.jar.*;

/** Read-only artifact inspector; reads every payload entry to verify JAR digests. */
public class InspectAab {
  static String quote(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n") + "\"";
  }
  static String hex(byte[] bytes) { return HexFormat.of().formatHex(bytes); }
  static Map<String,String> attrs(Resources.XmlElement element) {
    Map<String,String> result = new LinkedHashMap<>();
    for (Resources.XmlAttribute attr : element.getAttributeList()) {
      String value = attr.getValue();
      if (value.isEmpty() && attr.hasCompiledItem()) {
        Resources.Item item = attr.getCompiledItem();
        if (item.hasStr()) value = item.getStr().getValue();
        else if (item.hasPrim()) {
          Resources.Primitive primitive = item.getPrim();
          if (primitive.hasIntDecimalValue()) value = Integer.toString(primitive.getIntDecimalValue());
          else if (primitive.hasIntHexadecimalValue()) value = Integer.toString(primitive.getIntHexadecimalValue());
          else if (primitive.hasBooleanValue()) value = Boolean.toString(primitive.getBooleanValue());
        }
      }
      result.put(attr.getName(), value);
    }
    return result;
  }
  static void walk(Resources.XmlNode node, Map<String,String> metadata, Set<String> permissions, Set<String> schemes) {
    if (!node.hasElement()) return;
    Resources.XmlElement element = node.getElement();
    Map<String,String> values = attrs(element);
    switch (element.getName()) {
      case "manifest":
        for (String field : List.of("package", "versionName", "versionCode")) metadata.put(field, values.get(field));
        break;
      case "uses-sdk":
        for (String field : List.of("minSdkVersion", "targetSdkVersion")) metadata.put(field, values.get(field));
        break;
      case "application": metadata.put("debuggable", values.getOrDefault("debuggable", "false")); break;
      case "uses-permission": case "uses-permission-sdk-23": permissions.add(values.get("name")); break;
      case "data": if (values.containsKey("scheme")) schemes.add(values.get("scheme")); break;
    }
    for (Resources.XmlNode child : element.getChildList()) walk(child, metadata, permissions, schemes);
  }
  static String array(Collection<String> values) { return "[" + String.join(",", values.stream().map(InspectAab::quote).toList()) + "]"; }
  public static void main(String[] args) throws Exception {
    Path artifact = Paths.get(args[0]).toAbsolutePath();
    Map<String,String> metadata = new LinkedHashMap<>();
    Set<String> permissions = new TreeSet<>(), schemes = new TreeSet<>(), architectures = new TreeSet<>(), certificates = new TreeSet<>();
    List<String> unsignedPayloads = new ArrayList<>();
    int payloadCount = 0, signedPayloadCount = 0;
    boolean manifestLast = false;
    boolean manifestFirst = false;
    try (JarFile jar = new JarFile(artifact.toFile(), true)) {
      JarEntry manifest = jar.getJarEntry("base/manifest/AndroidManifest.xml");
      if (manifest == null) throw new IOException("AAB base manifest is missing");
      try (InputStream input = jar.getInputStream(manifest)) { walk(Resources.XmlNode.parseFrom(input), metadata, permissions, schemes); }
      List<JarEntry> entries = Collections.list(jar.entries());
      manifestLast = !entries.isEmpty() && entries.get(entries.size()-1).getName().equals("META-INF/MANIFEST.MF");
      manifestFirst = !entries.isEmpty() && entries.get(0).getName().equals("META-INF/MANIFEST.MF");
      for (JarEntry entry : entries) {
        if (entry.isDirectory()) continue;
        try (InputStream input = jar.getInputStream(entry)) { input.transferTo(OutputStream.nullOutputStream()); }
        String name = entry.getName();
        if (name.startsWith("base/lib/")) {
          String[] parts = name.split("/");
          if (parts.length >= 4) architectures.add(parts[2]);
        }
        if (name.toUpperCase(Locale.ROOT).startsWith("META-INF/")) continue;
        payloadCount++;
        CodeSigner[] signers = entry.getCodeSigners();
        if (signers == null || signers.length == 0) { unsignedPayloads.add(name); continue; }
        signedPayloadCount++;
        for (CodeSigner signer : signers) {
          java.security.cert.Certificate certificate = signer.getSignerCertPath().getCertificates().get(0);
          certificates.add(hex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
        }
      }
    }
    int streamedPayloadCount = 0, streamedSignedPayloadCount = 0;
    boolean streamManifestAvailable;
    List<String> streamedUnsignedPayloads = new ArrayList<>();
    Set<String> streamCertificates = new TreeSet<>();
    try (JarInputStream stream = new JarInputStream(Files.newInputStream(artifact), true)) {
      streamManifestAvailable = stream.getManifest() != null;
      for (JarEntry entry; (entry = stream.getNextJarEntry()) != null;) {
        stream.transferTo(OutputStream.nullOutputStream());
        if (entry.isDirectory() || entry.getName().toUpperCase(Locale.ROOT).startsWith("META-INF/")) continue;
        streamedPayloadCount++;
        CodeSigner[] signers = entry.getCodeSigners();
        if (signers == null || signers.length == 0) { streamedUnsignedPayloads.add(entry.getName()); continue; }
        streamedSignedPayloadCount++;
        for (CodeSigner signer : signers) {
          java.security.cert.Certificate certificate = signer.getSignerCertPath().getCertificates().get(0);
          streamCertificates.add(hex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
        }
      }
    }
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = new DigestInputStream(Files.newInputStream(artifact), digest)) { input.transferTo(OutputStream.nullOutputStream()); }
    List<String> fields = new ArrayList<>();
    fields.add("\"artifact\":"+quote(artifact.toString()));
    fields.add("\"sizeBytes\":"+Files.size(artifact));
    fields.add("\"sha256\":"+quote(hex(digest.digest())));
    for (Map.Entry<String,String> entry : metadata.entrySet()) {
      String key = entry.getKey(), value = entry.getValue();
      fields.add(quote(key)+":"+(List.of("versionCode", "minSdkVersion", "targetSdkVersion", "debuggable").contains(key) ? value : quote(value)));
    }
    fields.add("\"permissions\":"+array(permissions));
    fields.add("\"deepLinkSchemes\":"+array(schemes));
    fields.add("\"architectures\":"+array(architectures));
    fields.add("\"certificateSha256List\":"+array(certificates));
    fields.add("\"signatureVerifiedByJarFile\":"+(payloadCount > 0 && unsignedPayloads.isEmpty() && !certificates.isEmpty()));
    fields.add("\"signedPayloadEntries\":"+signedPayloadCount);
    fields.add("\"payloadEntries\":"+payloadCount);
    fields.add("\"unsignedPayloads\":"+array(unsignedPayloads));
    fields.add("\"manifestIsLastJarEntry\":"+manifestLast);
    fields.add("\"manifestIsFirstJarEntry\":"+manifestFirst);
    fields.add("\"jarInputStreamManifestAvailable\":"+streamManifestAvailable);
    fields.add("\"signatureVerifiedByJarInputStream\":"+(streamedPayloadCount == payloadCount && streamedUnsignedPayloads.isEmpty() && !streamCertificates.isEmpty()));
    fields.add("\"jarInputStreamPayloadEntries\":"+streamedPayloadCount);
    fields.add("\"jarInputStreamSignedPayloadEntries\":"+streamedSignedPayloadCount);
    fields.add("\"jarInputStreamUnsignedPayloads\":"+array(streamedUnsignedPayloads));
    fields.add("\"jarInputStreamCertificateSha256List\":"+array(streamCertificates));
    System.out.println("{"+String.join(",\n",fields)+"}");
  }
}
