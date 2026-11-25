package com.autocut.controller;

import com.autocut.entity.UserEntity;
import com.autocut.repository.RefreshTokenRepository;
import com.autocut.repository.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration test cho F01 (JWT + Refresh Cookie + Brute-force + Ticket) va F05 (CORS qua SecurityConfig).
 */
@SpringBootTest
class AuthControllerIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    private UserEntity createTestUser(String rawPassword, boolean mustChangePassword) {
        String email = "it-" + UUID.randomUUID() + "@autocut.test";
        UserEntity user = new UserEntity(email, passwordEncoder.encode(rawPassword), "Test User", "INSTRUCTOR");
        user.setMustChangePassword(mustChangePassword);
        user.setIsActive(true);
        return userRepository.save(user);
    }

    @Test
    @DisplayName("F05: CORS preflight OPTIONS /api/v1/auth/login tu localhost:3000 -> 200; origin la -> 403")
    void corsPreflightAllowsConfiguredOriginAndRejectsEvilOrigin() throws Exception {
        mvc.perform(options("/api/v1/auth/login")
                        .header("Origin", "http://localhost:3000")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "authorization,content-type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));

        mvc.perform(options("/api/v1/auth/login")
                        .header("Origin", "https://evil.example.com")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("AC-1..AC-4: /api/video/list khong token -> 401; login dung -> 200 JWT -> /api/video/list -> 200")
    void protectedEndpointRequiresJwtAndLoginIssuesValidToken() throws Exception {
        mvc.perform(get("/api/video/list"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));

        UserEntity user = createTestUser("MatKhau123", false);

        MvcResult loginResult = mvc.perform(post("/api/v1/auth/login")
                        .header("Origin", "http://localhost:3000")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + user.getEmail() + "\",\"password\":\"MatKhau123\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"))
                .andExpect(jsonPath("$.token_type").value("Bearer"))
                .andExpect(jsonPath("$.access_token").isString())
                .andExpect(jsonPath("$.user.email").value(user.getEmail()))
                .andReturn();

        Cookie refreshCookie = loginResult.getResponse().getCookie(AuthController.REFRESH_COOKIE_NAME);
        Assertions.assertNotNull(refreshCookie);
        Assertions.assertTrue(refreshCookie.isHttpOnly());

        JsonNode json = objectMapper.readTree(loginResult.getResponse().getContentAsString());
        String accessToken = json.get("access_token").asText();

        mvc.perform(get("/api/video/list")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk());

        mvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(user.getEmail()));
    }

    @Test
    @DisplayName("AC-5 & AC-6: refresh xoay vong token va doi mat khau thu hoi toan bo phien")
    void refreshRotationAndChangePasswordRevokesSessions() throws Exception {
        UserEntity user = createTestUser("MatKhau123", false);

        MvcResult loginRes = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + user.getEmail() + "\",\"password\":\"MatKhau123\"}"))
                .andExpect(status().isOk())
                .andReturn();

        Cookie r1 = loginRes.getResponse().getCookie(AuthController.REFRESH_COOKIE_NAME);
        String accessToken = objectMapper.readTree(loginRes.getResponse().getContentAsString())
                .get("access_token").asText();

        MvcResult refreshRes = mvc.perform(post("/api/v1/auth/refresh").cookie(r1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").isString())
                .andReturn();
        Cookie r2 = refreshRes.getResponse().getCookie(AuthController.REFRESH_COOKIE_NAME);
        Assertions.assertNotNull(r2);
        Assertions.assertNotEquals(r1.getValue(), r2.getValue());

        // Doi mat khau -> thu hoi tat ca refresh token
        mvc.perform(post("/api/v1/auth/change-password")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"current_password\":\"MatKhau123\",\"new_password\":\"MatKhauMoi9\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relogin_required").value(true));

        mvc.perform(post("/api/v1/auth/refresh").cookie(r2))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN_REUSED"));
    }

    @Test
    @DisplayName("AC-10/11 & FR-9: ve STREAM dung duoc qua ?ticket= nhung khong dung duoc cho endpoint khac")
    void streamTicketAuthenticatesMatchingStreamOnly() throws Exception {
        UserEntity user = createTestUser("MatKhau123", false);

        MvcResult loginRes = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + user.getEmail() + "\",\"password\":\"MatKhau123\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String accessToken = objectMapper.readTree(loginRes.getResponse().getContentAsString())
                .get("access_token").asText();

        String fakeSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        MvcResult ticketRes = mvc.perform(post("/api/v1/auth/tickets")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"STREAM\",\"resource_id\":\"" + fakeSha256 + "\"}"))
                .andExpect(status().isOk())
                .andReturn();

        String ticket = objectMapper.readTree(ticketRes.getResponse().getContentAsString())
                .get("ticket").asText();

        // Dung ve STREAM cho /api/video/list -> bi tu choi 401
        mvc.perform(get("/api/video/list").queryParam("ticket", ticket))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("TICKET_INVALID"));

        // Dung ve STREAM dung endpoint /stream/{hash} -> vuot qua Security (tra 404 vi file gia khong ton tai, khong phai 401)
        mvc.perform(get("/api/video/stream/" + fakeSha256).queryParam("ticket", ticket))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("FR-7: must_change_password=true bi chan /api/video/list voi 403 PASSWORD_CHANGE_REQUIRED")
    void mustChangePasswordBlocksVideoApiUntilChanged() throws Exception {
        UserEntity user = createTestUser("MatKhau123", true);

        MvcResult loginRes = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + user.getEmail() + "\",\"password\":\"MatKhau123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.must_change_password").value(true))
                .andReturn();
        String accessToken = objectMapper.readTree(loginRes.getResponse().getContentAsString())
                .get("access_token").asText();

        mvc.perform(get("/api/video/list")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("PASSWORD_CHANGE_REQUIRED"));
    }
}
