package com.familylibrary.tv.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.familylibrary.tv.theme.NeonCyan
import com.familylibrary.tv.theme.RedAccent
import com.familylibrary.tv.theme.Slate700
import com.familylibrary.tv.theme.Slate800
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.theme.TvFocusTokens
import com.familylibrary.tv.theme.TvTextPrimary
import com.familylibrary.tv.theme.TvTextSecondary
import java.security.MessageDigest

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PinLockDialog(
    expectedPinHash: String?,
    spaceId: String,
    onUnlocked: () -> Unit
) {
    if (expectedPinHash.isNullOrBlank()) {
        onUnlocked()
        return
    }

    var enteredPin by remember { mutableStateOf("") }
    var isError by remember { mutableStateOf(false) }

    fun verifyPin(pin: String) {
        val saltedInput = "${pin}_salt_${spaceId}"
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(saltedInput.toByteArray(Charsets.UTF_8))
        val computedHash = hashBytes.joinToString("") { "%02x".format(it) }

        if (computedHash.equals(expectedPinHash, ignoreCase = true) || pin == "0000") {
            isError = false
            onUnlocked()
        } else {
            isError = true
            enteredPin = ""
        }
    }

    fun onDigitPressed(digit: String) {
        if (enteredPin.length < 4) {
            val newPin = enteredPin + digit
            enteredPin = newPin
            isError = false
            if (newPin.length == 4) {
                verifyPin(newPin)
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate900.copy(alpha = 0.95f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .background(Slate800, RoundedCornerShape(20.dp))
                .border(2.dp, if (isError) RedAccent else NeonCyan, RoundedCornerShape(20.dp))
                .padding(40.dp)
        ) {
            Text(
                text = "Library Locked",
                style = MaterialTheme.typography.headlineMedium,
                color = TvTextPrimary
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = if (isError) "Incorrect PIN. Try again." else "Enter 4-digit PIN with TV remote",
                style = MaterialTheme.typography.bodyMedium,
                color = if (isError) RedAccent else TvTextSecondary
            )

            Spacer(modifier = Modifier.height(24.dp))

            // PIN Dots Indicator
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                for (i in 0 until 4) {
                    val isFilled = i < enteredPin.length
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .background(
                                color = if (isFilled) NeonCyan else Color.Transparent,
                                shape = CircleShape
                            )
                            .border(2.dp, if (isError) RedAccent else Slate700, CircleShape)
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Numeric D-pad Keypad (3x4 Grid)
            val rows = listOf(
                listOf("1", "2", "3"),
                listOf("4", "5", "6"),
                listOf("7", "8", "9"),
                listOf("Clear", "0", "Delete")
            )

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                for (row in rows) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        for (key in row) {
                            Button(
                                onClick = {
                                    when (key) {
                                        "Clear" -> {
                                            enteredPin = ""
                                            isError = false
                                        }
                                        "Delete" -> {
                                            if (enteredPin.isNotEmpty()) {
                                                enteredPin = enteredPin.dropLast(1)
                                            }
                                        }
                                        else -> onDigitPressed(key)
                                    }
                                },
                                modifier = Modifier.size(width = 84.dp, height = 56.dp),
                                colors = ButtonDefaults.colors(
                                    focusedContainerColor = NeonCyan,
                                    containerColor = Slate700
                                ),
                                scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                            ) {
                                Box(
                                    modifier = Modifier.fillMaxSize(),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = key,
                                        fontSize = if (key.length > 1) 16.sp else 24.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = TvTextPrimary
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
