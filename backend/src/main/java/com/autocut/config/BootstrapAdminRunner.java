package com.autocut.config;

import com.autocut.entity.UserEntity;
import com.autocut.repository.UserRepository;
import com.autocut.service.ConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * Tạo tài khoản ADMIN đầu tiên từ biến môi trường nếu hệ thống chưa có ADMIN.
 * Tuyệt đối không tạo mật khẩu mặc định trong mã nguồn.
 */
@Component
public class BootstrapAdminRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BootstrapAdminRunner.class);

    private final UserRepository userRepository;
    private final ConfigService configService;
    private final PasswordEncoder passwordEncoder;

    public BootstrapAdminRunner(
            UserRepository userRepository,
            ConfigService configService,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.configService = configService;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepository.existsByRoleIgnoreCase("ADMIN")) {
            return;
        }

        String email = configService.getEnv("AUTOCUT_BOOTSTRAP_ADMIN_EMAIL", "").trim().toLowerCase(Locale.ROOT);
        String password = configService.getEnv("AUTOCUT_BOOTSTRAP_ADMIN_PASSWORD", "");
        if (email.isEmpty() || password == null || password.isEmpty()) {
            log.warn("Chưa cấu hình AUTOCUT_BOOTSTRAP_ADMIN_EMAIL / AUTOCUT_BOOTSTRAP_ADMIN_PASSWORD; bỏ qua bootstrap admin.");
            return;
        }

        if (userRepository.findByEmailIgnoreCase(email).isPresent()) {
            return;
        }

        UserEntity admin = new UserEntity(
                email,
                passwordEncoder.encode(password),
                "Quản trị viên",
                "ADMIN"
        );
        admin.setMustChangePassword(true);
        admin.setIsActive(true);
        userRepository.save(admin);
        log.info("Đã tạo tài khoản admin khởi tạo cho email: {}", email);
    }
}
