package com.autocut.config;

import com.autocut.auth.JwtAuthFilter;
import com.autocut.auth.TicketAuthFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Cấu hình bảo mật trung tâm: JWT stateless, BCrypt(12), vé ?ticket= và CORS fail-closed (F01 + F05).
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            com.autocut.service.ConfigService configService,
            Environment environment) {
        boolean devLike = WebConfig.isDevLike(environment.getActiveProfiles());
        CorsConfiguration config = CorsSettings.build(
                configService.getEnv(CorsSettings.ENV_KEY, null), devLike);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            JwtAuthFilter jwtAuthFilter,
            TicketAuthFilter ticketAuthFilter,
            CorsConfigurationSource corsConfigurationSource) throws Exception {

        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(eh -> eh
                        .authenticationEntryPoint((req, res, ex) ->
                                writeSecurityError(res, HttpServletResponse.SC_UNAUTHORIZED, "AUTH_REQUIRED",
                                        "Yêu cầu đăng nhập để truy cập tài nguyên này."))
                        .accessDeniedHandler((req, res, ex) ->
                                writeSecurityError(res, HttpServletResponse.SC_FORBIDDEN, "ACCESS_DENIED",
                                        "Bạn không có quyền truy cập tài nguyên này."))
                )
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/", "/actuator/health", "/error").permitAll()
                        .requestMatchers(HttpMethod.POST,
                                "/api/v1/auth/login",
                                "/api/v1/auth/refresh",
                                "/api/v1/auth/logout").permitAll()
                        .anyRequest().authenticated()
                )
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(ticketAuthFilter, JwtAuthFilter.class);

        return http.build();
    }

    private static void writeSecurityError(HttpServletResponse res, int status, String code, String message)
            throws java.io.IOException {
        res.setStatus(status);
        res.setCharacterEncoding(StandardCharsets.UTF_8.name());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        JSON.writeValue(res.getWriter(), Map.of(
                "error", Map.of(
                        "code", code,
                        "message", message,
                        "details", Map.of()
                )
        ));
    }
}
