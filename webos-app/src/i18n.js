/*
 * The app's translations.  Each language maps the English text to its own;
 * anything missing shows in English, so a half-done language still works.
 * {name} is filled in by T(text, { name: value }).  Russian avoids number
 * agreement by writing counts as "ключей: 3".
 *
 * The language is the TV's menu language, unless one was picked with the
 * Language row (kept in the app's own storage).  The script's messages after
 * a repair are translated line by line by each language's *Script patterns.
 *
 * Adding a language: copy the es block and esScript, translate them, and add
 * the language to NAMES, DICTS and SCRIPTS.  tests/check-i18n.js checks that
 * every text is translated.
 */
(function () {
    'use strict';

    var NAMES = { en: 'English', ru: 'Русский', es: 'Español' };

    var ru = {
        'The script gave an unexpected answer.': 'Скрипт ответил что-то непонятное.',
        'No root access': 'Нет root-доступа',
        'This app runs as root through the Homebrew Channel.  Open the Homebrew Channel once, check it says the system is rooted, then come back.': 'Приложение работает от root через Homebrew Channel.  Откройте Homebrew Channel, убедитесь, что там написано, что система рутирована, и вернитесь.',
        'SSH works': 'SSH работает',
        'SSH works, with problems': 'SSH работает, но есть проблемы',
        'SSH needs fixing': 'SSH нужно починить',
        'Log in as root at {ip}, port 22.': 'Входите как root на {ip}, порт 22.',
        'Nobody can log in over SSH right now.  The buttons on the right fix it.': 'Сейчас по SSH войти нельзя.  Кнопки справа это исправят.',
        'running on port 22': 'работает на порту 22',
        'on, but not running': 'включён, но не запущен',
        'off': 'выключен',
        'password alpine': 'пароль alpine',
        ', and {n} keys': ', ключей: {n}',
        'your password': 'ваш пароль',
        '1 key': '1 ключ',
        '{n} keys': 'ключей: {n}',
        'nobody can log in': 'войти нельзя',
        'none': 'нет',
        'needs fixing': 'нужно исправить',
        'fine': 'в порядке',
        'on, a way back in': 'включён, запасной вход',
        'SSH server': 'SSH-сервер',
        'Log in with': 'Вход',
        'Keys file': 'Файл ключей',
        'Telnet': 'Telnet',
        'TV address': 'Адрес телевизора',
        'no network': 'нет сети',
        'Press OK or BACK to close.': 'Нажмите OK или НАЗАД, чтобы закрыть.',
        'Press OK to go ahead, or BACK to cancel.': 'Нажмите OK, чтобы продолжить, или НАЗАД для отмены.',
        'Working on it…': 'Выполняется…',
        '{title}: done': '{title}: готово',
        '{title}: something went wrong': '{title}: что-то пошло не так',
        'Set up a key': 'Настроить ключ',
        'Starting the pairing page…': 'Запуск страницы сопряжения…',
        'This TV has no Node.js, which the pairing page needs.  Use How to log in to add a key over telnet instead.': 'На этом телевизоре нет Node.js, который нужен странице сопряжения.  Добавьте ключ через telnet: смотрите «Как войти».',
        'The pairing page didn\'t start.': 'Страница сопряжения не запустилась.',
        'Add this key?': 'Добавить этот ключ?',
        'A key was sent from {comment}.  Check that this matches what the other device shows:': 'Ключ прислан с {comment}.  Проверьте, что он совпадает с тем, что показывает другое устройство:',
        'another device': 'другого устройства',
        'This is the first key: after the next restart the alpine password stops working, and only keys can log in.': 'Это первый ключ: после следующей перезагрузки пароль alpine перестанет работать, и войти можно будет только по ключу.',
        'It will be able to log in as root.': 'С ним можно будет войти как root.',
        'Press OK to add it, or BACK to turn it down.': 'Нажмите OK, чтобы добавить, или НАЗАД, чтобы отказаться.',
        'Connected.  Choose a key on the other device.': 'Подключено.  Выберите ключ на другом устройстве.',
        'Waiting for a phone or computer…': 'Ждём телефон или компьютер…',
        '{n} tries left for this code.': 'Осталось попыток для этого кода: {n}.',
        'Scan, or open on your computer': 'Отсканируйте или откройте на компьютере',
        'Then enter this code': 'Затем введите этот код',
        'Closes in {time}.  Press BACK to stop.': 'Закроется через {time}.  НАЗАД, чтобы остановить.',
        'Time ran out before a key was sent.  Nothing changed.': 'Время вышло, а ключ так и не прислали.  Ничего не изменилось.',
        'Too many wrong codes were typed, so the pairing page closed.  Nothing changed.': 'Слишком много неверных кодов, поэтому страница сопряжения закрылась.  Ничего не изменилось.',
        'The pairing page closed.  Nothing changed.': 'Страница сопряжения закрылась.  Ничего не изменилось.',
        'Adding the key…': 'Добавляем ключ…',
        'Key added': 'Ключ добавлен',
        'The key wasn\'t added': 'Ключ не добавлен',
        'The other device now shows how to log in.': 'На другом устройстве теперь показано, как войти.',
        'The key was turned down.  Nothing changed.': 'Ключ отклонён.  Ничего не изменилось.',
        'From a computer on the same network, in Terminal (Mac, Linux) or PowerShell (Windows):': 'С компьютера в той же сети, в Терминале (Mac, Linux) или PowerShell (Windows):',
        'This TV\'s SSH server is old, so newer computers need the two -o options above.': 'SSH-сервер на этом телевизоре старый, поэтому новым компьютерам нужны две опции -o выше.',
        'The password is alpine.': 'Пароль: alpine.',
        'It logs in with your key.  No key yet?  Use Set up a key.': 'Вход по вашему ключу.  Ключа ещё нет?  Выберите «Настроить ключ».',
        'If ssh says REMOTE HOST IDENTIFICATION HAS CHANGED, the TV\'s SSH keys were made again (after a reset, for example).  Check the fingerprint below, then run {cmd} on the computer and try again.': 'Если ssh пишет REMOTE HOST IDENTIFICATION HAS CHANGED, SSH-ключи телевизора были созданы заново (например, после сброса).  Сверьте отпечаток ниже, выполните {cmd} на компьютере и попробуйте снова.',
        'How to log in': 'Как войти',
        'Keys on this TV': 'Ключи на этом телевизоре',
        'No key can log in yet.  Use Set up a key to add one.': 'Пока ни один ключ не может войти.  Добавьте ключ через «Настроить ключ».',
        'And {n} more.': 'И ещё: {n}.',
        'Turn SSH on now': 'Включить SSH сейчас',
        'Fix my keys file': 'Исправить файл ключей',
        'This keeps a backup of the keys file, moves anything that isn\'t a working public key to a side file, repairs line endings and keys split over several lines, and sets the permissions the SSH server wants.': 'Сохраняется резервная копия файла ключей, всё, что не является рабочим открытым ключом, переносится в отдельный файл, исправляются концы строк и ключи, разбитые на несколько строк, и выставляются права, которые нужны SSH-серверу.',
        'Go back to password login': 'Вернуть вход по паролю',
        'This sets the keys file aside (kept as a backup) and turns on the Homebrew Channel\'s default login: user root, password alpine.  Key logins stop working until you add a key again.': 'Файл ключей откладывается в сторону (как резервная копия), и включается стандартный вход Homebrew Channel: пользователь root, пароль alpine.  Вход по ключам не будет работать, пока вы снова не добавите ключ.',
        'Anyone on your network can use that password, so set up a key again soon.': 'Этим паролем может воспользоваться любой в вашей сети, так что настройте ключ поскорее.',
        'Undo a change': 'Отменить изменение',
        'This puts back the most recent backup of the keys file, {name}.  The current keys file is backed up first.': 'Будет восстановлена последняя резервная копия файла ключей, {name}.  Текущий файл ключей сначала тоже сохраняется.',
        'Checking SSH…': 'Проверяем SSH…',
        'The Homebrew Channel isn\'t installed, so there\'s no SSH server on this TV.  Install it from rootmy.tv or your rooting tool.': 'Homebrew Channel не установлен, поэтому SSH-сервера на телевизоре нет.  Установите его через rootmy.tv или ваш инструмент для рута.',
        'The Homebrew Channel is in failsafe mode after a crash at startup, so SSH didn\'t start.  Restart the TV.': 'Homebrew Channel в аварийном режиме после сбоя при запуске, поэтому SSH не запустился.  Перезагрузите телевизор.',
        'SSH is turned off in the Homebrew Channel.  Turn SSH on now fixes that without a restart.': 'SSH выключен в Homebrew Channel.  «Включить SSH сейчас» исправит это без перезагрузки.',
        'SSH is turned on, but its server isn\'t running.  Turn SSH on now starts it.': 'SSH включён, но сервер не запущен.  «Включить SSH сейчас» его запустит.',
        'SSH is running, but it\'s off in the Homebrew Channel\'s settings, so it won\'t start after a restart.  Turn SSH on now keeps it on.': 'SSH работает, но выключен в настройках Homebrew Channel, поэтому после перезагрузки не запустится.  «Включить SSH сейчас» оставит его включённым.',
        'Nobody can log in: there\'s a keys file but no key in it works, and keys turn the password off.  Fix my keys file, set up a key, or go back to password login.': 'Войти нельзя: файл ключей есть, но ни один ключ в нём не работает, а с ключами пароль отключается.  Исправьте файл ключей, настройте ключ или верните вход по паролю.',
        'There\'s no key and no password, so nobody can log in.  Set up a key, or go back to password login.': 'Нет ни ключа, ни пароля, поэтому войти нельзя.  Настройте ключ или верните вход по паролю.',
        'A private key was pasted into the keys file.  It doesn\'t work there and shouldn\'t be on the TV: Fix my keys file moves it out.': 'В файл ключей вставлен закрытый ключ.  Там он не работает и не должен лежать на телевизоре: «Исправить файл ключей» уберёт его.',
        'The keys file has Windows line endings, hidden characters, a key split over several lines or a key in PuTTY\'s format.  Fix my keys file repairs that.': 'В файле ключей концы строк Windows, скрытые символы, ключ, разбитый на несколько строк, или ключ в формате PuTTY.  «Исправить файл ключей» это починит.',
        'The keys file has lines that aren\'t working keys.  Fix my keys file moves them to a side file.': 'В файле ключей есть строки, которые не являются рабочими ключами.  «Исправить файл ключей» перенесёт их в отдельный файл.',
        'Other users can change the keys file or a folder above it, so the SSH server ignores the keys.  Fix my keys file sets the right permissions.': 'Файл ключей или папку над ним могут менять другие пользователи, поэтому SSH-сервер игнорирует ключи.  «Исправить файл ключей» выставит правильные права.',
        'Anyone on your network can log in with the default password, alpine.  Set up a key to turn that off.': 'Любой в вашей сети может войти со стандартным паролем alpine.  Настройте ключ, чтобы это отключить.',
        'Telnet is off, so if SSH breaks, this app is the only way back in.': 'Telnet выключен, поэтому если SSH сломается, вернуться можно будет только через это приложение.',
        'Loading…': 'Загрузка…',
        'Reading how SSH is set up on this TV.': 'Смотрим, как настроен SSH на этом телевизоре.',
        'no restart needed': 'без перезагрузки',
        'keeps a backup': 'с резервной копией',
        'from your computer or phone': 'с компьютера или телефона',
        'the command for your computer': 'команда для компьютера',
        'if you\'re locked out': 'если войти не получается',
        'put a backup back': 'вернуть резервную копию',
        'Language': 'Язык',
        'Select': 'Выбрать',
        'Move': 'Перемещение',
        'Exit': 'Выход',
        'Auto ({lang})': 'Авто ({lang})'
    };

    var es = {
        'The script gave an unexpected answer.': 'El script dio una respuesta inesperada.',
        'No root access': 'Sin acceso root',
        'This app runs as root through the Homebrew Channel.  Open the Homebrew Channel once, check it says the system is rooted, then come back.': 'Esta aplicación funciona como root a través del Homebrew Channel.  Abra el Homebrew Channel, compruebe que indica que el sistema tiene root y vuelva.',
        'SSH works': 'SSH funciona',
        'SSH works, with problems': 'SSH funciona, con problemas',
        'SSH needs fixing': 'Hay que reparar SSH',
        'Log in as root at {ip}, port 22.': 'Inicie sesión como root en {ip}, puerto 22.',
        'Nobody can log in over SSH right now.  The buttons on the right fix it.': 'Ahora mismo nadie puede iniciar sesión por SSH.  Los botones de la derecha lo arreglan.',
        'running on port 22': 'funcionando en el puerto 22',
        'on, but not running': 'activado, pero sin funcionar',
        'off': 'desactivado',
        'password alpine': 'contraseña alpine',
        ', and {n} keys': ', y {n} claves',
        'your password': 'su contraseña',
        '1 key': '1 clave',
        '{n} keys': '{n} claves',
        'nobody can log in': 'nadie puede entrar',
        'none': 'ninguno',
        'needs fixing': 'hay que repararlo',
        'fine': 'correcto',
        'on, a way back in': 'activado, una vía de acceso',
        'SSH server': 'Servidor SSH',
        'Log in with': 'Acceso con',
        'Keys file': 'Archivo de claves',
        'Telnet': 'Telnet',
        'TV address': 'Dirección del televisor',
        'no network': 'sin red',
        'Press OK or BACK to close.': 'Presione OK o ATRÁS para cerrar.',
        'Press OK to go ahead, or BACK to cancel.': 'Presione OK para continuar, o ATRÁS para cancelar.',
        'Working on it…': 'Trabajando…',
        '{title}: done': '{title}: listo',
        '{title}: something went wrong': '{title}: algo salió mal',
        'Set up a key': 'Configurar una clave',
        'Starting the pairing page…': 'Iniciando la página de emparejamiento…',
        'This TV has no Node.js, which the pairing page needs.  Use How to log in to add a key over telnet instead.': 'Este televisor no tiene Node.js, que la página de emparejamiento necesita.  Agregue una clave por telnet: vea “Cómo iniciar sesión”.',
        'The pairing page didn\'t start.': 'La página de emparejamiento no se inició.',
        'Add this key?': '¿Agregar esta clave?',
        'A key was sent from {comment}.  Check that this matches what the other device shows:': 'Se envió una clave desde {comment}.  Compruebe que coincide con lo que muestra el otro dispositivo:',
        'another device': 'otro dispositivo',
        'This is the first key: after the next restart the alpine password stops working, and only keys can log in.': 'Es la primera clave: tras el próximo reinicio la contraseña alpine deja de funcionar y solo se podrá entrar con claves.',
        'It will be able to log in as root.': 'Podrá iniciar sesión como root.',
        'Press OK to add it, or BACK to turn it down.': 'Presione OK para agregarla, o ATRÁS para rechazarla.',
        'Connected.  Choose a key on the other device.': 'Conectado.  Elija una clave en el otro dispositivo.',
        'Waiting for a phone or computer…': 'Esperando un teléfono o computadora…',
        '{n} tries left for this code.': 'Quedan {n} intentos para este código.',
        'Scan, or open on your computer': 'Escanee, o abra en su computadora',
        'Then enter this code': 'Luego escriba este código',
        'Closes in {time}.  Press BACK to stop.': 'Se cierra en {time}.  Presione ATRÁS para detener.',
        'Time ran out before a key was sent.  Nothing changed.': 'Se acabó el tiempo sin que se enviara una clave.  No se cambió nada.',
        'Too many wrong codes were typed, so the pairing page closed.  Nothing changed.': 'Se escribieron demasiados códigos incorrectos, así que la página de emparejamiento se cerró.  No se cambió nada.',
        'The pairing page closed.  Nothing changed.': 'La página de emparejamiento se cerró.  No se cambió nada.',
        'Adding the key…': 'Agregando la clave…',
        'Key added': 'Clave agregada',
        'The key wasn\'t added': 'La clave no se agregó',
        'The other device now shows how to log in.': 'El otro dispositivo ahora muestra cómo iniciar sesión.',
        'The key was turned down.  Nothing changed.': 'La clave fue rechazada.  No se cambió nada.',
        'From a computer on the same network, in Terminal (Mac, Linux) or PowerShell (Windows):': 'Desde una computadora en la misma red, en Terminal (Mac, Linux) o PowerShell (Windows):',
        'This TV\'s SSH server is old, so newer computers need the two -o options above.': 'El servidor SSH de este televisor es antiguo, así que las computadoras nuevas necesitan las dos opciones -o de arriba.',
        'The password is alpine.': 'La contraseña es alpine.',
        'It logs in with your key.  No key yet?  Use Set up a key.': 'Se entra con su clave.  ¿Aún no tiene una?  Use “Configurar una clave”.',
        'If ssh says REMOTE HOST IDENTIFICATION HAS CHANGED, the TV\'s SSH keys were made again (after a reset, for example).  Check the fingerprint below, then run {cmd} on the computer and try again.': 'Si ssh dice REMOTE HOST IDENTIFICATION HAS CHANGED, las claves SSH del televisor se volvieron a crear (tras un restablecimiento, por ejemplo).  Compruebe la huella de abajo, ejecute {cmd} en la computadora y vuelva a intentarlo.',
        'How to log in': 'Cómo iniciar sesión',
        'Keys on this TV': 'Claves en este televisor',
        'No key can log in yet.  Use Set up a key to add one.': 'Todavía ninguna clave puede entrar.  Use “Configurar una clave” para agregar una.',
        'And {n} more.': 'Y {n} más.',
        'Turn SSH on now': 'Activar SSH ahora',
        'Fix my keys file': 'Reparar el archivo de claves',
        'This keeps a backup of the keys file, moves anything that isn\'t a working public key to a side file, repairs line endings and keys split over several lines, and sets the permissions the SSH server wants.': 'Esto guarda una copia del archivo de claves, mueve a un archivo aparte todo lo que no sea una clave pública válida, repara los finales de línea y las claves partidas en varias líneas, y pone los permisos que el servidor SSH exige.',
        'Go back to password login': 'Volver al inicio con contraseña',
        'This sets the keys file aside (kept as a backup) and turns on the Homebrew Channel\'s default login: user root, password alpine.  Key logins stop working until you add a key again.': 'Esto aparta el archivo de claves (se guarda como copia) y activa el acceso predeterminado del Homebrew Channel: usuario root, contraseña alpine.  El acceso con claves deja de funcionar hasta que vuelva a agregar una.',
        'Anyone on your network can use that password, so set up a key again soon.': 'Cualquiera en su red puede usar esa contraseña, así que configure una clave pronto.',
        'Undo a change': 'Deshacer un cambio',
        'This puts back the most recent backup of the keys file, {name}.  The current keys file is backed up first.': 'Esto restaura la copia más reciente del archivo de claves, {name}.  Antes se guarda una copia del archivo actual.',
        'Checking SSH…': 'Comprobando SSH…',
        'The Homebrew Channel isn\'t installed, so there\'s no SSH server on this TV.  Install it from rootmy.tv or your rooting tool.': 'El Homebrew Channel no está instalado, así que este televisor no tiene servidor SSH.  Instálelo desde rootmy.tv o su herramienta de root.',
        'The Homebrew Channel is in failsafe mode after a crash at startup, so SSH didn\'t start.  Restart the TV.': 'El Homebrew Channel está en modo a prueba de fallos tras un error al arrancar, así que SSH no se inició.  Reinicie el televisor.',
        'SSH is turned off in the Homebrew Channel.  Turn SSH on now fixes that without a restart.': 'SSH está desactivado en el Homebrew Channel.  “Activar SSH ahora” lo arregla sin reiniciar.',
        'SSH is turned on, but its server isn\'t running.  Turn SSH on now starts it.': 'SSH está activado, pero su servidor no funciona.  “Activar SSH ahora” lo inicia.',
        'SSH is running, but it\'s off in the Homebrew Channel\'s settings, so it won\'t start after a restart.  Turn SSH on now keeps it on.': 'SSH funciona, pero está desactivado en la configuración del Homebrew Channel, así que no arrancará tras un reinicio.  “Activar SSH ahora” lo deja activado.',
        'Nobody can log in: there\'s a keys file but no key in it works, and keys turn the password off.  Fix my keys file, set up a key, or go back to password login.': 'Nadie puede entrar: hay un archivo de claves pero ninguna funciona, y las claves desactivan la contraseña.  Repare el archivo de claves, configure una clave o vuelva al inicio con contraseña.',
        'There\'s no key and no password, so nobody can log in.  Set up a key, or go back to password login.': 'No hay clave ni contraseña, así que nadie puede entrar.  Configure una clave o vuelva al inicio con contraseña.',
        'A private key was pasted into the keys file.  It doesn\'t work there and shouldn\'t be on the TV: Fix my keys file moves it out.': 'Se pegó una clave privada en el archivo de claves.  Ahí no funciona y no debería estar en el televisor: “Reparar el archivo de claves” la saca.',
        'The keys file has Windows line endings, hidden characters, a key split over several lines or a key in PuTTY\'s format.  Fix my keys file repairs that.': 'El archivo de claves tiene finales de línea de Windows, caracteres ocultos, una clave partida en varias líneas o una clave en formato PuTTY.  “Reparar el archivo de claves” lo arregla.',
        'The keys file has lines that aren\'t working keys.  Fix my keys file moves them to a side file.': 'El archivo de claves tiene líneas que no son claves válidas.  “Reparar el archivo de claves” las mueve a un archivo aparte.',
        'Other users can change the keys file or a folder above it, so the SSH server ignores the keys.  Fix my keys file sets the right permissions.': 'Otros usuarios pueden modificar el archivo de claves o una carpeta superior, así que el servidor SSH ignora las claves.  “Reparar el archivo de claves” pone los permisos correctos.',
        'Anyone on your network can log in with the default password, alpine.  Set up a key to turn that off.': 'Cualquiera en su red puede entrar con la contraseña predeterminada, alpine.  Configure una clave para desactivarla.',
        'Telnet is off, so if SSH breaks, this app is the only way back in.': 'Telnet está desactivado, así que si SSH falla, esta aplicación es la única forma de volver a entrar.',
        'Loading…': 'Cargando…',
        'Reading how SSH is set up on this TV.': 'Revisando cómo está configurado SSH en este televisor.',
        'no restart needed': 'sin reiniciar',
        'keeps a backup': 'guarda una copia',
        'from your computer or phone': 'desde su computadora o teléfono',
        'the command for your computer': 'el comando para su computadora',
        'if you\'re locked out': 'si no puede entrar',
        'put a backup back': 'restaurar una copia',
        'Language': 'Idioma',
        'Select': 'Elegir',
        'Move': 'Mover',
        'Exit': 'Salir',
        'Auto ({lang})': 'Automático ({lang})'
    };

    // The script's messages after a repair, line by line
    var ruScript = [
        [/^Turned SSH on in the Homebrew Channel's settings\.$/, 'SSH включён в настройках Homebrew Channel.'],
        [/^The SSH server is already running\.$/, 'SSH-сервер уже работает.'],
        [/^Started the SSH server on port 22\.$/, 'SSH-сервер запущен на порту 22.'],
        [/^The SSH server didn't start\.  Restart the TV, then check again\.$/, 'SSH-сервер не запустился.  Перезагрузите телевизор и проверьте снова.'],
        [/^The Homebrew Channel isn't installed, so there's no SSH server to start\.$/, 'Homebrew Channel не установлен, поэтому запускать нечего.'],
        [/^The Homebrew Channel's SSH server \((.*)\) is missing\.  Reinstall the Homebrew Channel\.$/, 'SSH-сервера Homebrew Channel ($1) нет.  Переустановите Homebrew Channel.'],
        [/^There's no authorized_keys file to fix\.$/, 'Файла authorized_keys нет, исправлять нечего.'],
        [/^Backed up (\S+) to (\S+)$/, 'Резервная копия $1: $2'],
        [/^Moved what isn't a public key to (\S+)$/, 'Всё, что не является открытым ключом, перенесено в $1'],
        [/^Rewrote (\S+) \(found: (.*)\)$/, 'Файл $1 переписан (найдено: $2)'],
        [/^Made (\S+) writable by root only$/, 'Теперь в $1 может писать только root'],
        [/^Usable keys now: (\d+)$/, 'Рабочих ключей: $1'],
        [/^No key works and there's no password: use Go back to password login, or add a key\.$/, 'Ни один ключ не работает, а пароля нет: верните вход по паролю или добавьте ключ.'],
        [/^Set the keys file aside as (\S+)$/, 'Файл ключей отложен как $1'],
        [/^Password login is on: user root, password alpine\.(.*)$/, 'Вход по паролю включён: пользователь root, пароль alpine.$1'],
        [/  It stays on after a restart until a key is added\.$/, '  Он останется и после перезагрузки, пока не будет добавлен ключ.'],
        [/^Couldn't turn the password on\.$/, 'Не удалось включить пароль.'],
        [/^That isn't exactly one public key\.$/, 'Это не один открытый ключ.'],
        [/^That key is already there\.$/, 'Этот ключ уже есть.'],
        [/^Added the key\.$/, 'Ключ добавлен.'],
        [/^This is the first key, so after the next restart the alpine password stops working and only keys can log in\.$/, 'Это первый ключ, поэтому после следующей перезагрузки пароль alpine перестанет работать и войти можно будет только по ключу.'],
        [/^Put (\S+) back as authorized_keys\.$/, '$1 восстановлен как authorized_keys.']
    ];
    var esScript = [
        [/^Turned SSH on in the Homebrew Channel's settings\.$/, 'SSH activado en la configuración del Homebrew Channel.'],
        [/^The SSH server is already running\.$/, 'El servidor SSH ya está funcionando.'],
        [/^Started the SSH server on port 22\.$/, 'Servidor SSH iniciado en el puerto 22.'],
        [/^The SSH server didn't start\.  Restart the TV, then check again\.$/, 'El servidor SSH no se inició.  Reinicie el televisor y compruebe de nuevo.'],
        [/^The Homebrew Channel isn't installed, so there's no SSH server to start\.$/, 'El Homebrew Channel no está instalado, así que no hay servidor SSH que iniciar.'],
        [/^The Homebrew Channel's SSH server \((.*)\) is missing\.  Reinstall the Homebrew Channel\.$/, 'Falta el servidor SSH del Homebrew Channel ($1).  Reinstale el Homebrew Channel.'],
        [/^There's no authorized_keys file to fix\.$/, 'No hay archivo authorized_keys que reparar.'],
        [/^Backed up (\S+) to (\S+)$/, 'Copia de $1 guardada en $2'],
        [/^Moved what isn't a public key to (\S+)$/, 'Lo que no es una clave pública se movió a $1'],
        [/^Rewrote (\S+) \(found: (.*)\)$/, '$1 reescrito (encontrado: $2)'],
        [/^Made (\S+) writable by root only$/, 'Ahora solo root puede escribir en $1'],
        [/^Usable keys now: (\d+)$/, 'Claves válidas ahora: $1'],
        [/^No key works and there's no password: use Go back to password login, or add a key\.$/, 'Ninguna clave funciona y no hay contraseña: vuelva al inicio con contraseña o agregue una clave.'],
        [/^Set the keys file aside as (\S+)$/, 'Archivo de claves apartado como $1'],
        [/^Password login is on: user root, password alpine\.(.*)$/, 'Inicio con contraseña activado: usuario root, contraseña alpine.$1'],
        [/  It stays on after a restart until a key is added\.$/, '  Sigue activado tras reiniciar hasta que se agregue una clave.'],
        [/^Couldn't turn the password on\.$/, 'No se pudo activar la contraseña.'],
        [/^That isn't exactly one public key\.$/, 'Eso no es exactamente una clave pública.'],
        [/^That key is already there\.$/, 'Esa clave ya está.'],
        [/^Added the key\.$/, 'Clave agregada.'],
        [/^This is the first key, so after the next restart the alpine password stops working and only keys can log in\.$/, 'Es la primera clave, así que tras el próximo reinicio la contraseña alpine deja de funcionar y solo se podrá entrar con claves.'],
        [/^Put (\S+) back as authorized_keys\.$/, '$1 restaurado como authorized_keys.']
    ];

    var SCRIPTS = { ru: ruScript, es: esScript };
    var DICTS = { ru: ru, es: es };
    var KEY = 'sd.lang';

    function stored() {
        try { return window.localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
    }
    function tvLang() {
        var l = '';
        try {
            l = (window.webOSSystem && window.webOSSystem.locale) || (window.PalmSystem && window.PalmSystem.locale) ||
                navigator.language || (navigator.languages && navigator.languages[0]) || '';
        } catch (e) { l = ''; }
        l = String(l).toLowerCase().slice(0, 2);
        return DICTS[l] ? l : 'en';
    }
    var choice = stored();
    if (choice !== 'auto' && choice !== 'en' && !DICTS[choice]) { choice = 'auto'; }
    var lang = choice === 'auto' ? tvLang() : choice;
    var dict = DICTS[lang] || {};

    function T(text, vars) {
        var s = Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : text;
        if (vars) {
            s = s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m; });
        }
        return s;
    }

    // The script's output, translated line by line; English where nothing matches
    function TS(text) {
        var pats = SCRIPTS[lang];
        if (!pats || typeof text !== 'string') { return text; }
        return text.split('\n').map(function (line) {
            for (var i = 0; i < pats.length; i++) { line = line.replace(pats[i][0], pats[i][1]); }
            return line;
        }).join('\n');
    }

    function translatePage(root) {
        if (lang === 'en') { return; }
        var walker = document.createTreeWalker(root, 4 /* text */, null, false);
        var n;
        while ((n = walker.nextNode())) {
            var t = n.nodeValue.replace(/^\s+|\s+$/g, '');
            if (t && Object.prototype.hasOwnProperty.call(dict, t)) {
                n.nodeValue = n.nodeValue.replace(t, dict[t]);
            }
        }
        document.documentElement.lang = lang;
    }

    function order() { return ['auto', 'en'].concat(Object.keys(DICTS)); }
    function next() {
        var o = order(), i = o.indexOf(choice);
        var n = o[(i + 1) % o.length];
        try { window.localStorage.setItem(KEY, n); } catch (e) { return false; }
        return true;
    }
    function label() {
        return choice === 'auto' ? T('Auto ({lang})', { lang: NAMES[lang] }) : NAMES[choice];
    }

    window.SD_I18N = { T: T, TS: TS, scripts: SCRIPTS, lang: lang, choice: choice, translatePage: translatePage, next: next, label: label, dicts: DICTS, names: NAMES };
}());
