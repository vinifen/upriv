# DANGER — PERMANENT DATA LOSS
# PELIGRO — PÉRDIDA PERMANENTE DE DATOS
# 危险 — 永久数据丢失
# खतरा — स्थायी डेटा हानि

**Do not edit, delete, or rename anything in this folder.**
**No edite, borre ni renombre nada en esta carpeta.**
**请勿编辑、删除或重命名此文件夹中的任何内容。**
**इस फ़ोल्डर में कुछ भी संपादित, हटाएँ या नाम न बदलें।**

---

# DANGER — PERMANENT DATA LOSS

**Do not edit, delete, or rename anything in this folder.**

**Editing, deleting, or renaming any file here can destroy this vault permanently.** Knowing the password does not bring the data back.

The password does not contain the vault's keys. The keys are random and exist only sealed by the password: in the header, and in a key copy at the start of every file in `data/`. If those sealed keys are changed or deleted, the password has nothing left to unlock. File chunks remain on disk as ciphertext that cannot be decrypted.

## Do not touch the header

**`header/vault.header` and `header/vault.header.copy` hold the vault's sealed keys and say which files are current.** If both are damaged, the app can read the keys back from the files' key copies with the correct password, but only while those files are intact. There is no reset and no second password.

`header/vault.header.copy` is the same bytes as `header/vault.header`. When one of them is missing, unreadable, or older than the other, the app restores it from the one that opens the vault together with its index. A header file from an earlier time, or from before a password change, never repairs anything.

## What is in this folder

This layout does not change when a file is added.

- **`header/vault.header`** — the vault's keys sealed by the password, with the Argon2id salt and cost.
- **`header/vault.header.copy`** — an exact second copy of `header/vault.header`.
- **`index/root.idx.enc` and `index/root.idx.enc.copy`** — names and folders, encrypted, the same bytes. If one file is lost or unreadable, the app restores it from the other. If both are lost, the app can rebuild the names from the files themselves.
- **`data/*.blob`** — one encrypted file per document: a copy of the sealed keys, the document's contents, then a sealed copy of its name. The filename is not the document's name. Damaging one file destroys that document.

There are no plaintext documents here. A text editor will not show the vault's files. Saving any of these files from an editor can corrupt them and cause the same permanent loss.

---

# PELIGRO — PÉRDIDA PERMANENTE DE DATOS

**No edite, borre ni renombre nada en esta carpeta.**

**Editar, borrar o renombrar cualquier archivo de esta carpeta puede destruir este cofre de forma permanente.** Conocer la contraseña no recupera los datos.

La contraseña no contiene las claves del cofre. Las claves son aleatorias y solo existen selladas con la contraseña: en el header y en una copia de claves al inicio de cada archivo de `data/`. Si esas claves selladas se cambian o se borran, la contraseña ya no tiene nada que abrir. Los chunks siguen en el disco como texto cifrado que no se puede descifrar.

## No toque el header

**`header/vault.header` y `header/vault.header.copy` guardan las claves selladas del cofre e indican qué archivos están al día.** Si los dos se dañan, la aplicación puede recuperar las claves desde las copias de claves de los archivos con la contraseña correcta, pero solo mientras esos archivos estén intactos. No hay reinicio ni una segunda contraseña.

`header/vault.header.copy` tiene los mismos bytes que `header/vault.header`. Cuando uno de ellos falta, no se puede leer o es más antiguo que el otro, la aplicación lo restaura desde el que abre el cofre junto con su índice. Un archivo de header de otro momento, o de antes de un cambio de contraseña, nunca repara nada.

## Qué hay en esta carpeta

Esta estructura no cambia cuando se añade un archivo.

- **`header/vault.header`** — las claves del cofre selladas con la contraseña, con la sal y el coste de Argon2id.
- **`header/vault.header.copy`** — una segunda copia exacta de `header/vault.header`.
- **`index/root.idx.enc` y `index/root.idx.enc.copy`** — nombres y carpetas, cifrados, los mismos bytes. Si uno se pierde o no se puede leer, la aplicación lo restaura desde el otro. Si se pierden los dos, la aplicación puede reconstruir los nombres a partir de los propios archivos.
- **`data/*.blob`** — un archivo cifrado por documento: una copia de las claves selladas, el contenido del documento y luego una copia sellada de su nombre. El nombre del archivo no es el del documento. Dañar un archivo destruye ese documento.

Aquí no hay documentos en claro. Un editor de texto no muestra los archivos del cofre. Guardar cualquiera de estos archivos desde un editor puede corromperlos y provocar la misma pérdida permanente.

---

# 危险 — 永久数据丢失

**请勿编辑、删除或重命名此文件夹中的任何内容。**

**在此处编辑、删除或重命名任何文件，都可能永久毁掉此保险库。** 即使知道密码，也无法找回数据。

密码本身并不包含保险库的密钥。密钥是随机的，只以密码密封的形式存在：在 header 中，以及 `data/` 中每个文件开头的密钥副本中。若这些密封的密钥被改动或删除，密码就再也没有可解锁的对象。文件分块仍会留在磁盘上，但是无法解密的密文。

## 请勿改动 header

**`header/vault.header` 与 `header/vault.header.copy` 保存保险库的密封密钥，并标明哪些文件是最新的。** 若两者都损坏，只要文件本身完好，应用可以凭正确的密码从各文件的密钥副本中读回密钥。没有重置，也没有第二个密码。

`header/vault.header.copy` 与 `header/vault.header` 字节完全相同。若其中一个缺失、无法读取或比另一个旧，应用会用能与索引一起打开保险库的那一个来恢复它。来自更早时间或密码更改之前的 header 文件绝不会用来修复任何内容。

## 此文件夹中有什么

添加文件时，此目录结构不会改变。

- **`header/vault.header`** — 由密码密封的保险库密钥，以及 Argon2id 的盐与成本。
- **`header/vault.header.copy`** — `header/vault.header` 的精确第二份副本。
- **`index/root.idx.enc` 与 `index/root.idx.enc.copy`** — 加密的名称与文件夹，字节完全相同。若其中一份丢失或无法读取，应用会用另一份恢复。若两份都丢失，应用可以从文件本身重建名称。
- **`data/*.blob`** — 每个文档对应一个加密文件：一份密封密钥的副本、文档内容，然后是其名称的一份密封副本。文件名不是文档的真实名称。损坏一个文件会永久毁掉该文档。

此处没有明文文档。文本编辑器不会显示保险库中的文件。从编辑器保存这些文件可能导致损坏，并造成同样的永久损失。

---

# खतरा — स्थायी डेटा हानि

**इस फ़ोल्डर में कुछ भी संपादित, हटाएँ या नाम न बदलें।**

**यहाँ किसी भी फ़ाइल को संपादित, हटाना या नाम बदलना इस वॉल्ट को स्थायी रूप से नष्ट कर सकता है।** पासवर्ड जानने से डेटा वापस नहीं आता।

पासवर्ड में वॉल्ट की कुंजियाँ नहीं होतीं। कुंजियाँ यादृच्छिक हैं और केवल पासवर्ड से सीलबंद रूप में मौजूद हैं: हेडर में, और `data/` की हर फ़ाइल की शुरुआत में कुंजियों की एक प्रति में। यदि वे सीलबंद कुंजियाँ बदल दी जाएँ या हटा दी जाएँ, तो पासवर्ड के पास खोलने के लिए कुछ नहीं बचता। फ़ाइल के खंड डिस्क पर ऐसे सिफरटेक्स्ट के रूप में रह जाते हैं जिन्हें डिक्रिप्ट नहीं किया जा सकता।

## हेडर को न छुएँ

**`header/vault.header` और `header/vault.header.copy` वॉल्ट की सीलबंद कुंजियाँ रखते हैं और बताते हैं कि कौन-सी फ़ाइलें मौजूदा हैं।** यदि दोनों क्षतिग्रस्त हों, तो ऐप सही पासवर्ड से फ़ाइलों की कुंजी प्रतियों से कुंजियाँ वापस पढ़ सकता है, लेकिन केवल तब तक जब तक वे फ़ाइलें सही-सलामत हों। कोई रीसेट नहीं है, कोई दूसरा पासवर्ड नहीं है।

`header/vault.header.copy` बाइट-दर-बाइट `header/vault.header` जैसा ही है। जब इनमें से कोई गायब हो, पढ़ा न जा सके, या दूसरे से पुराना हो, तो ऐप उसे उस फ़ाइल से बहाल करता है जो अपने इंडेक्स के साथ वॉल्ट खोलती है। किसी पुराने समय की, या पासवर्ड बदलने से पहले की हेडर फ़ाइल कभी कुछ भी ठीक नहीं करती।

## इस फ़ोल्डर में क्या है

फ़ाइल जोड़ने पर यह संरचना नहीं बदलती।

- **`header/vault.header`** — पासवर्ड से सील की गई वॉल्ट की कुंजियाँ, Argon2id के साल्ट और लागत के साथ।
- **`header/vault.header.copy`** — `header/vault.header` की सटीक दूसरी प्रति।
- **`index/root.idx.enc` और `index/root.idx.enc.copy`** — एन्क्रिप्टेड नाम और फ़ोल्डर, एक जैसे बाइट। एक फ़ाइल खो जाए या पढ़ी न जा सके तो ऐप उसे दूसरी से बहाल करता है। दोनों खो जाएँ तो ऐप फ़ाइलों से ही नाम दोबारा बना सकता है।
- **`data/*.blob`** — हर दस्तावेज़ के लिए एक एन्क्रिप्टेड फ़ाइल: सीलबंद कुंजियों की एक प्रति, दस्तावेज़ की सामग्री, फिर उसके नाम की एक सीलबंद प्रति। फ़ाइलनाम दस्तावेज़ का असली नाम नहीं है। एक फ़ाइल बिगड़ने से वह दस्तावेज़ नष्ट हो जाता है।

यहाँ कोई सादा पाठ दस्तावेज़ नहीं है। टेक्स्ट एडिटर वॉल्ट की फ़ाइलें नहीं दिखाएगा। एडिटर से इनमें से किसी फ़ाइल को सहेजना उन्हें बिगाड़ सकता है और वही स्थायी हानि कर सकता है।
