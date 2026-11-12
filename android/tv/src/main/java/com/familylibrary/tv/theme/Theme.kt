package com.familylibrary.tv.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Border
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Glow
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

@OptIn(ExperimentalTvMaterial3Api::class)
private val TvDarkColorScheme = darkColorScheme(
    primary = NeonCyan,
    onPrimary = Slate900,
    surface = Slate800,
    onSurface = TvTextPrimary,
    surfaceVariant = Slate700,
    onSurfaceVariant = TvTextSecondary,
    background = Slate900,
    onBackground = TvTextPrimary
)

// 5% Overscan Safe Area Padding for 1080p Android TV screens (96px H, 54px V -> 48dp, 27dp)
val TvOverscanPadding = PaddingValues(horizontal = 48.dp, vertical = 27.dp)

// Standard Focus Indication tokens for TV remote D-Pad navigation
@OptIn(ExperimentalTvMaterial3Api::class)
object TvFocusTokens {
    const val FocusedScale = 1.06f
    val FocusedBorderStroke = BorderStroke(3.dp, NeonCyan)
    val FocusedBorder = Border(border = FocusedBorderStroke)
    val FocusedGlow = Glow(elevationColor = NeonCyanGlow, elevation = 16.dp)
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun FamilyTvTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = TvDarkColorScheme,
        typography = TvTypography,
        content = content
    )
}
