# 🔧 Configuration MongoDB - Chaîne de Connexion

## ✅ Votre Chaîne de Connexion Corrigée

Votre chaîne MongoDB originale :
```
mongodb+srv://TEST_db_user:<yqAjy0aZyUOyBvxr>@clustertest.ys1kzwq.mongodb.net/?appName=ClusterTEST
```

**Chaîne corrigée** (sans les `< >` et avec le nom de la base de données) :
```
mongodb+srv://TEST_db_user:yqAjy0aZyUOyBvxr@clustertest.ys1kzwq.mongodb.net/ubs?retryWrites=true&w=majority&appName=ClusterTEST
```

### Changements effectués :
1. ✅ Enlevé les `< >` autour du mot de passe
2. ✅ Ajouté `/ubs` avant le `?` (nom de la base de données)
3. ✅ Ajouté `retryWrites=true&w=majority` pour la compatibilité

---

## 📝 Créer le Fichier .env

### Option 1 : Via PowerShell

1. **Ouvrez PowerShell** dans le dossier `backend`

2. **Créez le fichier** :
   ```powershell
   cd C:\Users\azooz\Desktop\ubs\backend
   ```

3. **Créez le fichier .env** avec ce contenu :
   ```powershell
   @"
   PORT=3000
   MONGODB_URI=mongodb+srv://TEST_db_user:yqAjy0aZyUOyBvxr@clustertest.ys1kzwq.mongodb.net/ubs?retryWrites=true&w=majority&appName=ClusterTEST
   JWT_SECRET=UBS_Bank_Management_2025_Super_Secret_Key_Change_This_In_Production_!@#$%^&*
   NODE_ENV=development
   "@ | Out-File -FilePath .env -Encoding utf8
   ```

### Option 2 : Manuellement

1. **Ouvrez un éditeur de texte** (Notepad, VS Code, etc.)

2. **Créez un nouveau fichier** dans le dossier `backend/`

3. **Nommez-le** `.env` (avec le point au début)

4. **Copiez-collez ce contenu** :
   ```env
   PORT=3000
   MONGODB_URI=mongodb+srv://TEST_db_user:yqAjy0aZyUOyBvxr@clustertest.ys1kzwq.mongodb.net/ubs?retryWrites=true&w=majority&appName=ClusterTEST
   JWT_SECRET=UBS_Bank_Management_2025_Super_Secret_Key_Change_This_In_Production_!@#$%^&*
   NODE_ENV=development
   ```

5. **Sauvegardez** le fichier

---

## 🔐 Générer un JWT_SECRET Plus Sécurisé (Optionnel)

Pour générer une clé secrète plus sécurisée, utilisez :

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Puis remplacez `JWT_SECRET` dans le fichier `.env` par le résultat.

---

## ✅ Vérifier que ça Fonctionne

1. **Lancez le backend** :
   ```powershell
   cd C:\Users\azooz\Desktop\ubs\backend
   npm start
   ```

2. **Vous devriez voir** :
   ```
   MongoDB Connected
   ✅ Compte démo créé avec succès!
   Server running on port 3000
   ```

3. **Testez** : Ouvrez http://localhost:3000/health
   - Vous devriez voir : `{"success":true,"status":"OK",...}`

---

## 🌐 Pour les Plateformes Cloud (Render, Cyclic, etc.)

Quand vous déployez sur une plateforme cloud, utilisez cette chaîne dans les **Variables d'Environnement** :

**Variable** : `MONGODB_URI`  
**Valeur** : 
```
mongodb+srv://TEST_db_user:yqAjy0aZyUOyBvxr@clustertest.ys1kzwq.mongodb.net/ubs?retryWrites=true&w=majority&appName=ClusterTEST
```

⚠️ **Important** : 
- Ne mettez PAS les `< >` autour du mot de passe
- Assurez-vous que `/ubs` est présent (nom de la base de données)
- Vérifiez que votre IP est autorisée dans MongoDB Atlas (Network Access → 0.0.0.0/0)

---

## 🐛 Dépannage

### Erreur "MongoDB connection error"

**Vérifiez** :
- ✅ Le mot de passe est correct (sans `< >`)
- ✅ Le nom d'utilisateur est correct : `TEST_db_user`
- ✅ Votre IP est autorisée dans MongoDB Atlas
- ✅ Le cluster est actif dans MongoDB Atlas

### Erreur "Authentication failed"

**Vérifiez** :
- ✅ Le mot de passe dans l'URL correspond au mot de passe de l'utilisateur MongoDB
- ✅ L'utilisateur `TEST_db_user` existe dans MongoDB Atlas
- ✅ L'utilisateur a les permissions "Read and write to any database"

### Erreur "Network timeout"

**Vérifiez** :
- ✅ Votre connexion Internet fonctionne
- ✅ MongoDB Atlas Network Access autorise votre IP (0.0.0.0/0 pour toutes les IPs)
- ✅ Le cluster MongoDB est actif (pas en pause)

---

## 📋 Checklist

- [ ] Fichier `.env` créé dans le dossier `backend/`
- [ ] `MONGODB_URI` configuré avec la chaîne corrigée
- [ ] `JWT_SECRET` configuré
- [ ] Backend lancé et MongoDB connecté
- [ ] Test `/health` fonctionne
- [ ] Compte démo créé automatiquement

---

**🎉 Votre MongoDB est maintenant configuré !**

