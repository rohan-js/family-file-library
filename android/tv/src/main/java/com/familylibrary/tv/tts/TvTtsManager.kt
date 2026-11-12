package com.familylibrary.tv.tts

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

sealed class TtsAvailability {
    data object Checking : TtsAvailability()
    data class Ready(val engineName: String, val locale: Locale) : TtsAvailability()
    data class Unavailable(val reason: String) : TtsAvailability()
}

class TvTtsManager(private val context: Context) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var audioFocusRequest: AudioFocusRequest? = null

    private val _availability = MutableStateFlow<TtsAvailability>(TtsAvailability.Checking)
    val availability: StateFlow<TtsAvailability> = _availability.asStateFlow()

    private val _isSpeaking = MutableStateFlow(false)
    val isSpeaking: StateFlow<Boolean> = _isSpeaking.asStateFlow()

    init {
        checkAndInitialize()
    }

    private fun checkAndInitialize() {
        try {
            // Pre-flight probe: check if any TTS engines exist on this TV
            val tempTts = TextToSpeech(context, null)
            val engines = tempTts.engines
            tempTts.shutdown()

            if (engines.isNullOrEmpty()) {
                _availability.value = TtsAvailability.Unavailable(
                    "No speech engine installed on this TV."
                )
                return
            }

            // Initialize TTS engine
            tts = TextToSpeech(context, this)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize TextToSpeech: ${e.message}", e)
            _availability.value = TtsAvailability.Unavailable("TTS initialization error: ${e.message}")
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            val engine = tts!!
            val locale = Locale.getDefault()
            val langResult = engine.isLanguageAvailable(locale)

            val effectiveLocale = if (langResult >= TextToSpeech.LANG_AVAILABLE) {
                engine.language = locale
                locale
            } else {
                engine.language = Locale.US
                Locale.US
            }

            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    _isSpeaking.value = true
                }

                override fun onDone(utteranceId: String?) {
                    _isSpeaking.value = false
                    abandonAudioFocus()
                }

                override fun onError(utteranceId: String?) {
                    _isSpeaking.value = false
                    abandonAudioFocus()
                }
            })

            _availability.value = TtsAvailability.Ready(
                engineName = engine.defaultEngine ?: "Default",
                locale = effectiveLocale
            )
        } else {
            _availability.value = TtsAvailability.Unavailable("TextToSpeech engine init failed.")
        }
    }

    fun speak(text: String) {
        if (_availability.value !is TtsAvailability.Ready) return
        if (text.isBlank()) return

        requestAudioFocus()
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "read_aloud_${System.currentTimeMillis()}")
    }

    fun stop() {
        tts?.stop()
        _isSpeaking.value = false
        abandonAudioFocus()
    }

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()

            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(playbackAttributes)
                .setOnAudioFocusChangeListener { focusChange ->
                    if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        stop()
                    }
                }
                .build()

            audioFocusRequest = focusRequest
            audioManager.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                { focusChange ->
                    if (focusChange == AudioManager.AUDIOFOCUS_LOSS) stop()
                },
                AudioManager.STREAM_ACCESSIBILITY,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    fun shutdown() {
        stop()
        tts?.shutdown()
        tts = null
    }

    companion object {
        private const val TAG = "TvTtsManager"
    }
}
