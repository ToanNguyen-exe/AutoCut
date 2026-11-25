package com.autocut.auth;

import com.autocut.entity.AuthTicketEntity;
import com.autocut.entity.UserEntity;
import com.autocut.repository.AuthTicketRepository;
import com.autocut.repository.UserRepository;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

class TicketServiceTest {

    private AuthTicketRepository ticketRepository;
    private UserRepository userRepository;
    private TicketService ticketService;

    @BeforeEach
    void setUp() {
        ticketRepository = Mockito.mock(AuthTicketRepository.class);
        userRepository = Mockito.mock(UserRepository.class);
        ticketService = new TicketService(ticketRepository, userRepository);
        when(ticketRepository.save(any(AuthTicketEntity.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("AC-10: Ve SSE chi dung 1 lan, lan 2 bi tu choi voi TICKET_INVALID")
    void sseTicket_secondUse_rejected() {
        UserEntity user = new UserEntity("gv@truong.edu.vn", "$2a$12$abc", "GV", "INSTRUCTOR");
        user.setId(5L);
        user.setIsActive(true);
        when(userRepository.findById(5L)).thenReturn(Optional.of(user));

        TicketService.IssuedTicket issued = ticketService.issue(5L, "SSE", "7");
        String hash = AuthService.sha256Hex(issued.ticket());
        AuthTicketEntity entity = new AuthTicketEntity(hash, 5L, "SSE", "7", true, Instant.now().plusSeconds(60));

        when(ticketRepository.findByTicketHash(hash)).thenReturn(Optional.of(entity));
        when(ticketRepository.markUsedIfValid(eq(hash), eq("SSE"), eq("7"), any(Instant.class)))
                .thenReturn(1)
                .thenReturn(0);

        AuthPrincipal principal = ticketService.consume(issued.ticket(), "SSE", "7");
        Assertions.assertEquals(5L, principal.userId());

        AuthException second = Assertions.assertThrows(AuthException.class,
                () -> ticketService.consume(issued.ticket(), "SSE", "7"));
        Assertions.assertEquals("TICKET_INVALID", second.getCode());
    }

    @Test
    @DisplayName("AC-11: Ve STREAM sai tai nguyen hoac user bi khoa phai bi tu choi")
    void ticket_wrongResourceAndInactiveUser_rejected() {
        UserEntity inactive = new UserEntity("locked@truong.edu.vn", "$2a$12$abc", "Locked", "INSTRUCTOR");
        inactive.setId(9L);
        inactive.setIsActive(false);

        String hash = AuthService.sha256Hex("raw-ticket");
        AuthTicketEntity entity = new AuthTicketEntity(hash, 9L, "STREAM", "42", false, Instant.now().plusSeconds(300));
        when(ticketRepository.findByTicketHash(hash)).thenReturn(Optional.of(entity));
        when(ticketRepository.markUsedIfValid(eq(hash), eq("STREAM"), eq("43"), any(Instant.class))).thenReturn(0);
        when(ticketRepository.markUsedIfValid(eq(hash), eq("STREAM"), eq("42"), any(Instant.class))).thenReturn(1);
        when(userRepository.findById(9L)).thenReturn(Optional.of(inactive));

        AuthException wrongRes = Assertions.assertThrows(AuthException.class,
                () -> ticketService.consume("raw-ticket", "STREAM", "43"));
        Assertions.assertEquals("TICKET_INVALID", wrongRes.getCode());

        AuthException inactiveEx = Assertions.assertThrows(AuthException.class,
                () -> ticketService.consume("raw-ticket", "STREAM", "42"));
        Assertions.assertEquals("TICKET_INVALID", inactiveEx.getCode());
    }
}
