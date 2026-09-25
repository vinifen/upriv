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

The password does not contain the master key. That key is random and exists only sealed inside the header. If that sealed key is changed or deleted, the password has nothing left to unlock. File chunks remain on disk as ciphertext that cannot be decrypted.

## Do not touch the header

**`header/vault.header` and `header/vault.header.copy` are the only copies of the sealed key in this store.** Damage both and every file in this vault is gone forever, even with the correct password. There is no reset and no second key.

`header/vault.header.copy` is the same bytes as `header/vault.header`. If the main file is missing, unreadable, or its sealed key does not open while this copy does, the app restores the main file from the copy. A copy from before a password change is not used. When both files match, a wrong password is not tried twice.

## What is in this folder

This layout does not change when a file is added.

- **`header/vault.header`** — Argon2id salt and cost, and the master key sealed by the password.
- **`header/vault.header.copy`** — an exact second copy of `header/vault.header`.
- **`index/root.idx.enc`** — names and folders, encrypted. If this file is lost, the name list is lost.
- **`data/*.chunk.enc`** — file contents in encrypted chunks. A chunk filename is not the file's name. Damaging one chunk destroys that piece of data.

There are no plaintext documents here. A text editor will not show the vault's files. Saving any of these files from an editor can corrupt them and cause the same permanent loss.

---

# PELIGRO — PÉRDIDA PERMANENTE DE DATOS

**No edite, borre ni renombre nada en esta carpeta.**

**Editar, borrar o renombrar cualquier archivo de esta carpeta puede destruir este cofre de forma permanente.** Conocer la contraseña no recupera los datos.

La contraseña no contiene la clave maestra. Esa clave es aleatoria y solo existe sellada dentro del header. Si se cambia o se borra esa clave sellada, la contraseña ya no tiene nada que abrir. Los chunks siguen en el disco como texto cifrado que no se puede descifrar.

## No toque el header

**`header/vault.header` y `header/vault.header.copy` son las únicas copias de la clave sellada en este store.** Si las dos se dañan, todos los archivos de este cofre desaparecen para siempre, aunque la contraseña sea la correcta. No hay reinicio ni una segunda clave.

`header/vault.header.copy` tiene los mismos bytes que `header/vault.header`. Si el archivo principal falta, no se puede leer, o su clave sellada no abre y esta copia sí, la aplicación restaura el archivo principal desde la copia. Una copia anterior a un cambio de contraseña no se usa. Cuando ambos archivos coinciden, una contraseña incorrecta no se prueba dos veces.

## Qué hay en esta carpeta

Esta estructura no cambia cuando se añade un archivo.

- **`header/vault.header`** — sal y coste de Argon2id, y la clave maestra sellada con la contraseña.
- **`header/vault.header.copy`** — una segunda copia exacta de `header/vault.header`.
- **`index/root.idx.enc`** — nombres y carpetas, cifrados. Si este archivo se pierde, se pierde la lista de nombres.
- **`data/*.chunk.enc`** — el contenido de los archivos, en trozos cifrados. El nombre de un chunk no es el nombre del archivo. Dañar un chunk destruye ese trozo de datos.

Aquí no hay documentos en claro. Un editor de texto no muestra los archivos del cofre. Guardar cualquiera de estos archivos desde un editor puede corromperlos y provocar la misma pérdida permanente.

---

# 危险 — 永久数据丢失

**请勿编辑、删除或重命名此文件夹中的任何内容。**

**在此处编辑、删除或重命名任何文件，都可能永久毁掉此保险库。** 即使知道密码，也无法找回数据。

密码本身并不包含主密钥。主密钥是随机的，仅以密封形式存在于 header 中。若该密封密钥被改动或删除，密码就再也没有可解锁的对象。文件分块仍会留在磁盘上，但是无法解密的密文。

## 请勿改动 header

**`header/vault.header` 与 `header/vault.header.copy` 是本 store 中密封密钥仅有的两份副本。** 若两者都损坏，即使密码正确，此保险库中的所有文件也将永久丢失。没有重置，也没有第二把密钥。

`header/vault.header.copy` 与 `header/vault.header` 字节完全相同。若主文件缺失、无法读取，或其密封密钥打不开而此副本可以，应用会用该副本恢复主文件。密码更改之前留下的旧副本不会被使用。当两个文件一致时，输错密码不会再试一次。

## 此文件夹中有什么

添加文件时，此目录结构不会改变。

- **`header/vault.header`** — Argon2id 的盐与成本，以及由密码密封的主密钥。
- **`header/vault.header.copy`** — `header/vault.header` 的精确第二份副本。
- **`index/root.idx.enc`** — 加密的名称与文件夹。若此文件丢失，名称列表也会丢失。
- **`data/*.chunk.enc`** — 以加密分块存放的文件内容。分块文件名不是文件的真实名称。损坏一个分块会永久毁掉那一段数据。

此处没有明文文档。文本编辑器不会显示保险库中的文件。从编辑器保存这些文件可能导致损坏，并造成同样的永久损失。

---

# खतरा — स्थायी डेटा हानि

**इस फ़ोल्डर में कुछ भी संपादित, हटाएँ या नाम न बदलें।**

**यहाँ किसी भी फ़ाइल को संपादित, हटाना या नाम बदलना इस वॉल्ट को स्थायी रूप से नष्ट कर सकता है।** पासवर्ड जानने से डेटा वापस नहीं आता।

पासवर्ड में मास्टर कुंजी नहीं होती। वह कुंजी यादृच्छिक है और केवल हेडर में सीलबंद रूप में मौजूद है। यदि वह सीलबंद कुंजी बदल दी जाए या हटा दी जाए, तो पासवर्ड के पास खोलने के लिए कुछ नहीं बचता। फ़ाइल के खंड डिस्क पर ऐसे सिफरटेक्स्ट के रूप में रह जाते हैं जिन्हें डिक्रिप्ट नहीं किया जा सकता।

## हेडर को न छुएँ

**`header/vault.header` और `header/vault.header.copy` इस store में सीलबंद कुंजी की एकमात्र प्रतियाँ हैं।** दोनों क्षतिग्रस्त हों तो सही पासवर्ड के बावजूद इस वॉल्ट की हर फ़ाइल हमेशा के लिए चली जाती है। कोई रीसेट नहीं है, कोई दूसरी कुंजी नहीं है।

`header/vault.header.copy` बाइट-दर-बाइट `header/vault.header` जैसा ही है। यदि मुख्य फ़ाइल गायब है, पढ़ी नहीं जा सकती, या उसकी सीलबंद कुंजी नहीं खुलती और यह प्रति खुलती है, तो ऐप मुख्य फ़ाइल को इस प्रति से बहाल करता है। पासवर्ड बदलने से पहले की प्रति इस्तेमाल नहीं होती। जब दोनों फ़ाइलें एक जैसी हों, गलत पासवर्ड पर दोबारा प्रयास नहीं किया जाता।

## इस फ़ोल्डर में क्या है

फ़ाइल जोड़ने पर यह संरचना नहीं बदलती।

- **`header/vault.header`** — Argon2id का साल्ट और लागत, तथा पासवर्ड से सील की गई मास्टर कुंजी।
- **`header/vault.header.copy`** — `header/vault.header` की सटीक दूसरी प्रति।
- **`index/root.idx.enc`** — एन्क्रिप्टेड नाम और फ़ोल्डर। यह फ़ाइल खो जाए तो नामों की सूची खो जाती है।
- **`data/*.chunk.enc`** — एन्क्रिप्टेड खंडों में फ़ाइल सामग्री। खंड का फ़ाइलनाम फ़ाइल का असली नाम नहीं है। एक खंड बिगड़ने से उस हिस्से का डेटा नष्ट हो जाता है।

यहाँ कोई सादा पाठ दस्तावेज़ नहीं है। टेक्स्ट एडिटर वॉल्ट की फ़ाइलें नहीं दिखाएगा। एडिटर से इनमें से किसी फ़ाइल को सहेजना उन्हें बिगाड़ सकता है और वही स्थायी हानि कर सकता है।
