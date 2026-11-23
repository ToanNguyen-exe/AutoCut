package com.autocut.config;

import com.autocut.controller.AuthController;
import com.autocut.entity.UserEntity;
import com.autocut.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Khởi tạo dữ liệu người dùng ban đầu trong Database nếu bảng users đang rỗng.
 */
@Component
public class UserSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(UserSeeder.class);
    private final UserRepository userRepository;

    public UserSeeder(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            if (userRepository.count() == 0) {
                log.info("Bảng users rỗng. Tiến hành khởi tạo tài khoản ban đầu vào Database...");

                UserEntity admin = new UserEntity(
                        "admin@autocut.ai",
                        AuthController.hashPassword("admin123"),
                        "Nguyễn Văn Toàn",
                        "ADMIN"
                );
                userRepository.save(admin);

                UserEntity sv4 = new UserEntity(
                        "sv4@autocut.ai",
                        AuthController.hashPassword("ui123"),
                        "Hoàng Thị Mai",
                        "MEMBER"
                );
                userRepository.save(sv4);

                log.info("Đã tạo thành công 2 tài khoản ban đầu trong Database (admin@autocut.ai, sv4@autocut.ai)");
            }
        } catch (Exception e) {
            log.warn("Không thể kiểm tra hoặc khởi tạo UserSeeder: {}", e.getMessage());
        }
    }
}
